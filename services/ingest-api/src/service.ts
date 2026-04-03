import { randomUUID } from 'node:crypto';

import {
  eventNames,
  topicByEventName,
  type EventEnvelope,
  type EventName,
} from '@context-lake/shared-events';
import { createRepositoryContext, withTransaction, type DbTransaction } from '@context-lake/shared-db';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';

import type {
  AgentSessionIngestRequest,
  CustomerIngestRequest,
  IngestionAcceptedResponse,
  OrderIngestRequest,
} from './contracts.js';
import { ApiError } from './errors.js';
import { IngestionMetrics } from './metrics.js';
import { hashRequestBody } from './tracing.js';

export interface IngestServiceDependencies {
  pool: Pool;
  logger: FastifyBaseLogger;
  metrics: IngestionMetrics;
}

interface BaseIngestContext {
  tenantId: string;
  traceId: string;
  idempotencyKey: string;
  source: string;
  actorId?: string;
}

type ResourceType = 'customer' | 'order' | 'agent_session';

interface ExistingResultLoader {
  (tx: DbTransaction, tenantId: string, resourceId: string): Promise<IngestionAcceptedResponse>;
}

export class IngestService {
  constructor(private readonly deps: IngestServiceDependencies) {}

  async ingestCustomer(
    payload: CustomerIngestRequest,
    context: BaseIngestContext,
  ): Promise<IngestionAcceptedResponse> {
    return this.runIngestion({
      context,
      requestType: 'customer',
      requestPayload: payload,
      loadExisting: async (tx, tenantId, resourceId) => {
        const customer = await createRepositoryContext(tx).customers.findById(tenantId, resourceId);

        if (!customer) {
          throw new ApiError(404, 'NOT_FOUND', 'idempotent resource not found');
        }

        const outbox = await createRepositoryContext(tx).outbox.findLatestByEntity(
          tenantId,
          'customer',
          resourceId,
        );

        if (!outbox) {
          throw new ApiError(404, 'NOT_FOUND', 'outbox event not found for customer');
        }

        return {
          request_id: outbox.headers.request_id as string,
          resource_id: customer.id,
          resource_type: 'customer',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: true,
          trace_id: outbox.trace_id,
          tenant_id: tenantId,
        };
      },
      execute: async (tx, requestId) => {
        const repositories = createRepositoryContext(tx);
        const customer = await repositories.customers.insert({
          tenant_id: context.tenantId,
          external_ref: payload.external_ref,
          email: payload.email,
          full_name: payload.full_name,
          status: payload.status,
          metadata: payload.metadata,
        });

        const event = this.buildEvent({
          eventName: eventNames.customerCreated,
          entityType: 'customer',
          entityId: customer.id,
          traceId: context.traceId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          idempotencyKey: context.idempotencyKey,
          source: context.source,
          payload: {
            customer_id: customer.id,
            external_ref: customer.external_ref,
            email: customer.email,
            full_name: customer.full_name,
            status: customer.status,
          },
        });

        const outbox = await repositories.outbox.insert({
          event,
          topic: topicByEventName[event.event_type],
          partitionKey: `${context.tenantId}:${customer.id}`,
          headers: {
            request_id: requestId,
          },
        });

        await repositories.ingestionRequests.insert({
          id: requestId,
          tenant_id: context.tenantId,
          source: context.source,
          request_type: 'customer',
          status: 'completed',
          trace_id: context.traceId,
          idempotency_key: context.idempotencyKey,
          payload,
          resource_type: 'customer',
          resource_id: customer.id,
          completed_at: new Date().toISOString(),
        });

        await repositories.idempotencyKeys.reserve({
          tenant_id: context.tenantId,
          scope: 'ingest.customer',
          idempotency_key: context.idempotencyKey,
          request_hash: hashRequestBody(payload),
          resource_type: 'customer',
          resource_id: customer.id,
        });

        return {
          request_id: requestId,
          resource_id: customer.id,
          resource_type: 'customer',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: false,
          trace_id: context.traceId,
          tenant_id: context.tenantId,
        };
      },
    });
  }

  async ingestOrder(
    payload: OrderIngestRequest,
    context: BaseIngestContext,
  ): Promise<IngestionAcceptedResponse> {
    return this.runIngestion({
      context,
      requestType: 'order',
      requestPayload: payload,
      loadExisting: async (tx, tenantId, resourceId) => {
        const order = await createRepositoryContext(tx).orders.findById(tenantId, resourceId);

        if (!order) {
          throw new ApiError(404, 'NOT_FOUND', 'idempotent resource not found');
        }

        const outbox = await createRepositoryContext(tx).outbox.findLatestByEntity(
          tenantId,
          'order',
          resourceId,
        );

        if (!outbox) {
          throw new ApiError(404, 'NOT_FOUND', 'outbox event not found for order');
        }

        return {
          request_id: outbox.headers.request_id as string,
          resource_id: order.id,
          resource_type: 'order',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: true,
          trace_id: outbox.trace_id,
          tenant_id: tenantId,
        };
      },
      execute: async (tx, requestId) => {
        const repositories = createRepositoryContext(tx);
        const customer = await repositories.customers.findById(context.tenantId, payload.customer_id);

        if (!customer) {
          throw new ApiError(404, 'NOT_FOUND', 'customer not found');
        }

        const order = await repositories.orders.insert({
          tenant_id: context.tenantId,
          customer_id: payload.customer_id,
          order_number: payload.order_number,
          status: payload.status,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
          metadata: payload.metadata,
        });

        const event = this.buildEvent({
          eventName: eventNames.orderCreated,
          entityType: 'order',
          entityId: order.id,
          traceId: context.traceId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          idempotencyKey: context.idempotencyKey,
          source: context.source,
          payload: {
            order_id: order.id,
            customer_id: order.customer_id,
            order_number: order.order_number,
            status: order.status,
            amount_cents: order.amount_cents,
            currency: order.currency,
          },
        });

        const outbox = await repositories.outbox.insert({
          event,
          topic: topicByEventName[event.event_type],
          partitionKey: `${context.tenantId}:${order.id}`,
          headers: {
            request_id: requestId,
          },
        });

        await repositories.ingestionRequests.insert({
          id: requestId,
          tenant_id: context.tenantId,
          source: context.source,
          request_type: 'order',
          status: 'completed',
          trace_id: context.traceId,
          idempotency_key: context.idempotencyKey,
          payload,
          resource_type: 'order',
          resource_id: order.id,
          completed_at: new Date().toISOString(),
        });

        await repositories.idempotencyKeys.reserve({
          tenant_id: context.tenantId,
          scope: 'ingest.order',
          idempotency_key: context.idempotencyKey,
          request_hash: hashRequestBody(payload),
          resource_type: 'order',
          resource_id: order.id,
        });

        return {
          request_id: requestId,
          resource_id: order.id,
          resource_type: 'order',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: false,
          trace_id: context.traceId,
          tenant_id: context.tenantId,
        };
      },
    });
  }

  async ingestAgentSession(
    payload: AgentSessionIngestRequest,
    context: BaseIngestContext,
  ): Promise<IngestionAcceptedResponse> {
    return this.runIngestion({
      context,
      requestType: 'agent_session',
      requestPayload: payload,
      loadExisting: async (tx, tenantId, resourceId) => {
        const session = await createRepositoryContext(tx).agentSessions.findById(tenantId, resourceId);

        if (!session) {
          throw new ApiError(404, 'NOT_FOUND', 'idempotent resource not found');
        }

        const outbox = await createRepositoryContext(tx).outbox.findLatestByEntity(
          tenantId,
          'agent_session',
          resourceId,
        );

        if (!outbox) {
          throw new ApiError(404, 'NOT_FOUND', 'outbox event not found for session');
        }

        return {
          request_id: outbox.headers.request_id as string,
          resource_id: session.id,
          resource_type: 'agent_session',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: true,
          trace_id: outbox.trace_id,
          tenant_id: tenantId,
        };
      },
      execute: async (tx, requestId) => {
        const repositories = createRepositoryContext(tx);
        const session = await repositories.agentSessions.insert({
          tenant_id: context.tenantId,
          customer_id: payload.customer_id ?? null,
          order_id: payload.order_id ?? null,
          status: payload.status,
          trace_id: context.traceId,
          channel: payload.channel,
          context_summary: payload.context_summary,
          started_at: payload.started_at ?? new Date().toISOString(),
          ended_at: payload.ended_at ?? null,
        });

        const event = this.buildEvent({
          eventName: eventNames.agentSessionStarted,
          entityType: 'agent_session',
          entityId: session.id,
          traceId: context.traceId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          idempotencyKey: context.idempotencyKey,
          source: context.source,
          payload: {
            agent_session_id: session.id,
            customer_id: session.customer_id ?? undefined,
            order_id: session.order_id ?? undefined,
            channel: session.channel,
          },
        });

        const outbox = await repositories.outbox.insert({
          event,
          topic: topicByEventName[event.event_type],
          partitionKey: `${context.tenantId}:${session.id}`,
          headers: {
            request_id: requestId,
          },
        });

        await repositories.ingestionRequests.insert({
          id: requestId,
          tenant_id: context.tenantId,
          source: context.source,
          request_type: 'agent_session',
          status: 'completed',
          trace_id: context.traceId,
          idempotency_key: context.idempotencyKey,
          payload,
          resource_type: 'agent_session',
          resource_id: session.id,
          completed_at: new Date().toISOString(),
        });

        await repositories.idempotencyKeys.reserve({
          tenant_id: context.tenantId,
          scope: 'ingest.agent_session',
          idempotency_key: context.idempotencyKey,
          request_hash: hashRequestBody(payload),
          resource_type: 'agent_session',
          resource_id: session.id,
        });

        return {
          request_id: requestId,
          resource_id: session.id,
          resource_type: 'agent_session',
          event_id: outbox.event_id,
          outbox_status: outbox.publish_status,
          duplicate: false,
          trace_id: context.traceId,
          tenant_id: context.tenantId,
        };
      },
    });
  }

  private async runIngestion<TPayload>({
    context,
    requestType,
    requestPayload,
    execute,
    loadExisting,
  }: {
    context: BaseIngestContext;
    requestType: string;
    requestPayload: TPayload;
    execute: (tx: DbTransaction, requestId: string) => Promise<IngestionAcceptedResponse>;
    loadExisting: ExistingResultLoader;
  }) {
    this.deps.metrics.incrementIngestionRequests();

    try {
      return await withTransaction(this.deps.pool, async (tx) => {
        const repositories = createRepositoryContext(tx);
        const requestHash = hashRequestBody(requestPayload);
        const scope = `ingest.${requestType}`;
        const existing = await repositories.idempotencyKeys.findByKey(
          context.tenantId,
          scope,
          context.idempotencyKey,
        );

        if (existing) {
          if (existing.request_hash !== requestHash) {
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'idempotency key has already been used with a different request payload',
            );
          }

          await repositories.idempotencyKeys.touch(existing.id);

          if (!existing.resource_id) {
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'idempotent request is still being processed',
            );
          }

          return loadExisting(tx, context.tenantId, existing.resource_id);
        }

        const requestId = randomUUID();
        this.deps.logger.info(
          {
            tenant_id: context.tenantId,
            trace_id: context.traceId,
            request_id: requestId,
            request_type: requestType,
          },
          'processing ingestion request',
        );

        const result = await execute(tx, requestId);

        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return withTransaction(this.deps.pool, async (tx) => {
          const repositories = createRepositoryContext(tx);
          const existingRequest = await repositories.ingestionRequests.findByIdempotencyKey(
            context.tenantId,
            context.idempotencyKey,
          );

          if (!existingRequest) {
            throw error;
          }

          const existing = await repositories.idempotencyKeys.findByKey(
            context.tenantId,
            `ingest.${requestType}`,
            context.idempotencyKey,
          );

          if (existing && existing.request_hash !== hashRequestBody(requestPayload)) {
            throw new ApiError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'idempotency key has already been used with a different request payload',
            );
          }

          if (!existingRequest.resource_id) {
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'idempotent request is still being processed');
          }

          return loadExisting(tx, context.tenantId, existingRequest.resource_id);
        });
      }

      throw error;
    }
  }

  private buildEvent({
    eventName,
    entityType,
    entityId,
    tenantId,
    traceId,
    actorId,
    idempotencyKey,
    source,
    payload,
  }: {
    eventName: EventName;
    entityType: ResourceType | 'agent_session';
    entityId: string;
    tenantId: string;
    traceId: string;
    actorId?: string;
    idempotencyKey?: string;
    source: string;
    payload: EventEnvelope['payload'];
  }): EventEnvelope {
    const now = new Date().toISOString();

    return {
      event_id: randomUUID(),
      event_type: eventName,
      event_version: 1,
      tenant_id: tenantId,
      trace_id: traceId,
      actor_id: actorId,
      entity_type: entityType,
      entity_id: entityId,
      occurred_at: now,
      produced_at: now,
      source,
      idempotency_key: idempotencyKey,
      payload,
    } as EventEnvelope;
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
