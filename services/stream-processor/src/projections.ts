import { createRepositoryContext, withTransaction, type DbTransaction } from '@context-lake/shared-db';
import { eventNames, type EventEnvelope } from '@context-lake/shared-events';
import { createLogger } from '@context-lake/shared-logging';
import type { Pool } from 'pg';

import type { ProjectionContext } from './types.js';

export interface ProjectionApplierDependencies {
  pool: Pool;
  logger: ReturnType<typeof createLogger>;
}

export class ProjectionApplier {
  constructor(private readonly deps: ProjectionApplierDependencies) {}

  async apply(context: ProjectionContext) {
    return withTransaction(this.deps.pool, async (tx) => {
      const repositories = createRepositoryContext(tx);
      const alreadyProcessed = await repositories.projectionState.hasProcessedEvent(
        context.consumerName,
        context.event.event_id,
      );

      if (alreadyProcessed) {
        this.deps.logger.info(
          {
            event_id: context.event.event_id,
            topic: context.topic,
            offset: context.offset,
          },
          'projection event already applied',
        );
        return { applied: false, reason: 'duplicate' as const };
      }

      const handlerApplied = await applyProjectionHandler(tx, context.event);

      if (!handlerApplied) {
        return { applied: false, reason: 'out_of_order' as const };
      }

      await repositories.projectionState.recordEventApplication({
        consumer_name: context.consumerName,
        topic: context.topic,
        partition: context.partition,
        kafka_offset: context.offset,
        event_id: context.event.event_id,
        event_type: context.event.event_type,
        tenant_id: context.event.tenant_id,
        entity_type: context.event.entity_type,
        entity_id: context.event.entity_id,
      });

      return { applied: true as const };
    });
  }

  async deadLetter(input: {
    consumerName: string;
    topic: string;
    partition: number;
    offset: string;
    payload: Record<string, unknown>;
    failureReason: string;
    event?: Partial<EventEnvelope>;
  }) {
    await createRepositoryContext(this.deps.pool).projectionState.insertDeadLetter({
      consumer_name: input.consumerName,
      topic: input.topic,
        partition: input.partition,
        kafka_offset: input.offset,
      event_id: input.event?.event_id ?? null,
      event_type: input.event?.event_type ?? null,
      tenant_id: input.event?.tenant_id ?? null,
      trace_id: input.event?.trace_id ?? null,
      failure_reason: input.failureReason,
      payload: input.payload,
    });
  }

  async resetViews() {
    await withTransaction(this.deps.pool, async (tx) => {
      const repositories = createRepositoryContext(tx);
      await repositories.customerContextView.truncate();
      await repositories.orderContextView.truncate();
      await repositories.agentSessionContextView.truncate();
      await repositories.projectionState.clearProjectionState();
    });
  }
}

async function applyProjectionHandler(tx: DbTransaction, event: EventEnvelope) {
  const repositories = createRepositoryContext(tx);

  switch (event.event_type) {
    case eventNames.customerCreated: {
      const payload = event.payload;
      return repositories.customerContextView.upsert({
        tenant_id: event.tenant_id,
        customer_id: payload.customer_id,
        external_ref: payload.external_ref,
        email: payload.email,
        full_name: payload.full_name,
        status: payload.status,
        customer_metadata: {},
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.customerUpdated: {
      const existing = await repositories.customerContextView.findById(
        event.tenant_id,
        event.payload.customer_id,
      );
      if (!existing) {
        return null;
      }
      if (isOlderEvent(existing.source_occurred_at, event.occurred_at)) {
        return null;
      }

      return repositories.customerContextView.upsert({
        tenant_id: existing.tenant_id,
        customer_id: existing.customer_id,
        external_ref: existing.external_ref,
        email: existing.email,
        full_name: existing.full_name,
        status: event.payload.status ?? existing.status,
        customer_metadata: existing.customer_metadata,
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.orderCreated: {
      const payload = event.payload;
      return repositories.orderContextView.upsert({
        tenant_id: event.tenant_id,
        order_id: payload.order_id,
        customer_id: payload.customer_id,
        order_number: payload.order_number,
        status: payload.status,
        amount_cents: payload.amount_cents,
        currency: payload.currency,
        order_metadata: {},
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.orderStatusChanged: {
      const existing = await repositories.orderContextView.findById(
        event.tenant_id,
        event.payload.order_id,
      );
      if (!existing) {
        return null;
      }
      if (isOlderEvent(existing.source_occurred_at, event.occurred_at)) {
        return null;
      }

      return repositories.orderContextView.upsert({
        tenant_id: existing.tenant_id,
        order_id: existing.order_id,
        customer_id: existing.customer_id,
        order_number: existing.order_number,
        status: event.payload.new_status,
        amount_cents: existing.amount_cents,
        currency: existing.currency,
        order_metadata: existing.order_metadata,
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.agentSessionStarted: {
      const payload = event.payload;
      return repositories.agentSessionContextView.upsert({
        tenant_id: event.tenant_id,
        agent_session_id: payload.agent_session_id,
        customer_id: payload.customer_id ?? null,
        order_id: payload.order_id ?? null,
        status: 'active',
        channel: payload.channel,
        last_context_request_id: null,
        last_context_query_text: null,
        last_context_scope: [],
        last_response_id: null,
        last_response_model: null,
        last_response_token_count: null,
        session_summary: {},
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.agentContextRequested: {
      const existing = await repositories.agentSessionContextView.findById(
        event.tenant_id,
        event.payload.agent_session_id,
      );
      if (!existing) {
        return null;
      }
      if (isOlderEvent(existing.source_occurred_at, event.occurred_at)) {
        return null;
      }

      return repositories.agentSessionContextView.upsert({
        tenant_id: existing.tenant_id,
        agent_session_id: existing.agent_session_id,
        customer_id: existing.customer_id,
        order_id: existing.order_id,
        status: existing.status,
        channel: existing.channel,
        last_context_request_id: event.payload.request_id,
        last_context_query_text: event.payload.query_text,
        last_context_scope: event.payload.context_scope,
        last_response_id: existing.last_response_id,
        last_response_model: existing.last_response_model,
        last_response_token_count: existing.last_response_token_count,
        session_summary: existing.session_summary,
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    case eventNames.agentResponseGenerated: {
      const existing = await repositories.agentSessionContextView.findById(
        event.tenant_id,
        event.payload.agent_session_id,
      );
      if (!existing) {
        return null;
      }
      if (isOlderEvent(existing.source_occurred_at, event.occurred_at)) {
        return null;
      }

      return repositories.agentSessionContextView.upsert({
        tenant_id: existing.tenant_id,
        agent_session_id: existing.agent_session_id,
        customer_id: existing.customer_id,
        order_id: existing.order_id,
        status: existing.status,
        channel: existing.channel,
        last_context_request_id: existing.last_context_request_id,
        last_context_query_text: existing.last_context_query_text,
        last_context_scope: existing.last_context_scope,
        last_response_id: event.payload.response_id,
        last_response_model: event.payload.model,
        last_response_token_count: event.payload.token_count,
        session_summary: existing.session_summary,
        source_event_id: event.event_id,
        source_event_version: event.event_version,
        source_occurred_at: event.occurred_at,
      });
    }
    default:
      return null;
  }
}

function isOlderEvent(current: string | Date, incoming: string) {
  const currentMillis = new Date(current).getTime();
  const incomingMillis = new Date(incoming).getTime();
  return incomingMillis < currentMillis;
}
