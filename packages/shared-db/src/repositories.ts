import type { EventEnvelope, EventName } from '@context-lake/shared-events';
import type { TopicName } from '@context-lake/shared-types';

import type { SqlExecutor } from './client.js';
import type {
  AgentSessionRow,
  AgentAuditLogRow,
  AgentSessionContextViewRow,
  ContextAuditReferenceRow,
  CustomerRow,
  CustomerContextViewRow,
  IdempotencyKeyRow,
  IngestionRequestRow,
  OrderRow,
  OrderContextViewRow,
  OutboxEventRow,
  ProjectionDeadLetterRow,
  ProjectionEventApplicationRow,
  ResourcePointer,
} from './types.js';

interface InsertCustomerInput {
  tenant_id: string;
  external_ref: string;
  email: string;
  full_name: string;
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
}

interface InsertOrderInput {
  tenant_id: string;
  customer_id: string;
  order_number: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  amount_cents: number;
  currency: string;
  metadata: Record<string, unknown>;
}

interface InsertAgentSessionInput {
  tenant_id: string;
  customer_id: string | null;
  order_id: string | null;
  status: 'active' | 'completed' | 'failed';
  trace_id: string;
  channel: 'api' | 'cli' | 'worker';
  context_summary: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
}

interface InsertIngestionRequestInput {
  id: string;
  tenant_id: string;
  source: string;
  request_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  trace_id: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  resource_type: ResourcePointer['resource_type'];
  resource_id: string;
  completed_at: string | null;
}

interface ReserveIdempotencyKeyInput {
  tenant_id: string;
  scope: string;
  idempotency_key: string;
  request_hash: string;
  resource_type: ResourcePointer['resource_type'] | null;
  resource_id: string | null;
}

export function createCustomerRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, customerId: string) {
      const result = await db.query<CustomerRow>(
        `select * from customers where tenant_id = $1 and id = $2`,
        [tenantId, customerId],
      );

      return result.rows[0] ?? null;
    },

    async insert(input: InsertCustomerInput) {
      const result = await db.query<CustomerRow>(
        `insert into customers (
          tenant_id,
          external_ref,
          email,
          full_name,
          status,
          metadata
        ) values ($1, $2, $3, $4, $5, $6::jsonb)
        returning *`,
        [
          input.tenant_id,
          input.external_ref,
          input.email,
          input.full_name,
          input.status,
          JSON.stringify(input.metadata),
        ],
      );

      return result.rows[0];
    },
  };
}

export function createOrderRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, orderId: string) {
      const result = await db.query<OrderRow>(
        `select * from orders where tenant_id = $1 and id = $2`,
        [tenantId, orderId],
      );

      return result.rows[0] ?? null;
    },

    async insert(input: InsertOrderInput) {
      const result = await db.query<OrderRow>(
        `insert into orders (
          tenant_id,
          customer_id,
          order_number,
          status,
          amount_cents,
          currency,
          metadata
        ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        returning *`,
        [
          input.tenant_id,
          input.customer_id,
          input.order_number,
          input.status,
          input.amount_cents,
          input.currency,
          JSON.stringify(input.metadata),
        ],
      );

      return result.rows[0];
    },
  };
}

export function createAgentSessionRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, sessionId: string) {
      const result = await db.query<AgentSessionRow>(
        `select * from agent_sessions where tenant_id = $1 and id = $2`,
        [tenantId, sessionId],
      );

      return result.rows[0] ?? null;
    },

    async insert(input: InsertAgentSessionInput) {
      const result = await db.query<AgentSessionRow>(
        `insert into agent_sessions (
          tenant_id,
          customer_id,
          order_id,
          status,
          trace_id,
          channel,
          context_summary,
          started_at,
          ended_at
        ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        returning *`,
        [
          input.tenant_id,
          input.customer_id,
          input.order_id,
          input.status,
          input.trace_id,
          input.channel,
          JSON.stringify(input.context_summary),
          input.started_at,
          input.ended_at,
        ],
      );

      return result.rows[0];
    },
  };
}

export function createIngestionRequestRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, requestId: string) {
      const result = await db.query<IngestionRequestRow>(
        `select * from ingestion_requests where tenant_id = $1 and id = $2`,
        [tenantId, requestId],
      );

      return result.rows[0] ?? null;
    },

    async findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
      const result = await db.query<IngestionRequestRow>(
        `select *
         from ingestion_requests
         where tenant_id = $1
           and idempotency_key = $2`,
        [tenantId, idempotencyKey],
      );

      return result.rows[0] ?? null;
    },

    async insert(input: InsertIngestionRequestInput) {
      const result = await db.query<IngestionRequestRow>(
        `insert into ingestion_requests (
          id,
          tenant_id,
          source,
          request_type,
          status,
          trace_id,
          idempotency_key,
          payload,
          resource_type,
          resource_id,
          completed_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        returning *`,
        [
          input.id,
          input.tenant_id,
          input.source,
          input.request_type,
          input.status,
          input.trace_id,
          input.idempotency_key,
          JSON.stringify(input.payload),
          input.resource_type,
          input.resource_id,
          input.completed_at,
        ],
      );

      return result.rows[0];
    },
  };
}

export function createIdempotencyRepository(db: SqlExecutor) {
  return {
    async findByKey(tenantId: string, scope: string, key: string) {
      const result = await db.query<IdempotencyKeyRow>(
        `select * from idempotency_keys where tenant_id = $1 and scope = $2 and idempotency_key = $3`,
        [tenantId, scope, key],
      );

      return result.rows[0] ?? null;
    },

    async reserve(input: ReserveIdempotencyKeyInput) {
      const result = await db.query<IdempotencyKeyRow>(
        `insert into idempotency_keys (
          tenant_id,
          scope,
          idempotency_key,
          request_hash,
          resource_type,
          resource_id
        ) values ($1, $2, $3, $4, $5, $6)
        returning *`,
        [
          input.tenant_id,
          input.scope,
          input.idempotency_key,
          input.request_hash,
          input.resource_type,
          input.resource_id,
        ],
      );

      return result.rows[0];
    },

    async attachResource(id: string, pointer: ResourcePointer) {
      const result = await db.query<IdempotencyKeyRow>(
        `update idempotency_keys
         set resource_type = $2,
             resource_id = $3,
             last_seen_at = now()
         where id = $1
         returning *`,
        [id, pointer.resource_type, pointer.resource_id],
      );

      return result.rows[0] ?? null;
    },

    async touch(id: string) {
      const result = await db.query<IdempotencyKeyRow>(
        `update idempotency_keys
         set last_seen_at = now()
         where id = $1
         returning *`,
        [id],
      );

      return result.rows[0] ?? null;
    },
  };
}

export interface InsertOutboxEventInput {
  event: EventEnvelope;
  topic: TopicName;
  partitionKey: string;
  headers?: Record<string, unknown>;
}

export function createOutboxRepository(db: SqlExecutor) {
  return {
    async insert(input: InsertOutboxEventInput) {
      const result = await db.query<OutboxEventRow>(
        `insert into outbox_events (
          event_id,
          tenant_id,
          topic,
          partition_key,
          event_name,
          event_version,
          trace_id,
          actor_id,
          entity_type,
          entity_id,
          idempotency_key,
          payload,
          headers,
          occurred_at,
          available_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15
        )
        returning *`,
        [
          input.event.event_id,
          input.event.tenant_id,
          input.topic,
          input.partitionKey,
          input.event.event_type,
          input.event.event_version,
          input.event.trace_id,
          input.event.actor_id ?? null,
          input.event.entity_type,
          input.event.entity_id,
          input.event.idempotency_key ?? null,
          JSON.stringify(input.event.payload),
          JSON.stringify(input.headers ?? {}),
          input.event.occurred_at,
          input.event.produced_at,
        ],
      );

      return result.rows[0];
    },

    async listReadyForPublishing(limit = 100) {
      const result = await db.query<OutboxEventRow>(
        `select *
         from outbox_events
         where publish_status in ('pending', 'failed')
           and available_at <= now()
         order by available_at asc, created_at asc
         limit $1`,
        [limit],
      );

      return result.rows;
    },

    async findLatestByEntity(tenantId: string, entityType: string, entityId: string) {
      const result = await db.query<OutboxEventRow>(
        `select *
         from outbox_events
         where tenant_id = $1
           and entity_type = $2
           and entity_id = $3
         order by created_at desc
         limit 1`,
        [tenantId, entityType, entityId],
      );

      return result.rows[0] ?? null;
    },

    async findById(eventId: string) {
      const result = await db.query<OutboxEventRow>(
        `select * from outbox_events where event_id = $1`,
        [eventId],
      );

      return result.rows[0] ?? null;
    },

    async countPending() {
      const result = await db.query<{ count: string }>(
        `select count(*)::text as count
         from outbox_events
         where publish_status in ('pending', 'failed')
           and available_at <= now()`,
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    async claimBatch(limit: number) {
      const selected = await db.query<{ event_id: string }>(
        `select event_id
         from outbox_events
         where publish_status in ('pending', 'failed')
           and available_at <= now()
         order by available_at asc, created_at asc
         limit $1
         for update`,
        [limit],
      );

      if (selected.rows.length === 0) {
        return [];
      }

      const claimed: OutboxEventRow[] = [];

      for (const row of selected.rows) {
        const result = await db.query<OutboxEventRow>(
          `update outbox_events
           set publish_status = 'processing',
               locked_at = now(),
               attempt_count = attempt_count + 1,
               last_error = null
           where event_id = $1
           returning *`,
          [row.event_id],
        );

        if (result.rows[0]) {
          claimed.push(result.rows[0]);
        }
      }

      return claimed;
    },

    async markPublished(eventId: string) {
      const result = await db.query<OutboxEventRow>(
        `update outbox_events
         set publish_status = 'published',
             published_at = now(),
             locked_at = null,
             last_error = null
         where event_id = $1
         returning *`,
        [eventId],
      );

      return result.rows[0];
    },

    async markFailed(eventId: string, reason: string, availableAt: string) {
      const result = await db.query<OutboxEventRow>(
        `update outbox_events
         set publish_status = 'failed',
             last_error = $2,
             locked_at = null,
             available_at = $3
         where event_id = $1
         returning *`,
        [eventId, reason, availableAt],
      );

      return result.rows[0];
    },
  };
}

interface ProjectionEventApplicationInput {
  consumer_name: string;
  topic: string;
  partition: number;
  kafka_offset: string;
  event_id: string;
  event_type: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
}

interface ProjectionDeadLetterInput {
  consumer_name: string;
  topic: string;
  partition: number;
  kafka_offset: string;
  event_id: string | null;
  event_type: string | null;
  tenant_id: string | null;
  trace_id: string | null;
  failure_reason: string;
  payload: Record<string, unknown>;
}

export function createProjectionStateRepository(db: SqlExecutor) {
  return {
    async recordEventApplication(input: ProjectionEventApplicationInput) {
      const result = await db.query<ProjectionEventApplicationRow>(
        `insert into projection_event_applications (
          consumer_name,
          topic,
          partition,
          kafka_offset,
          event_id,
          event_type,
          tenant_id,
          entity_type,
          entity_id
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict do nothing
        returning *`,
        [
          input.consumer_name,
          input.topic,
          input.partition,
          input.kafka_offset,
          input.event_id,
          input.event_type,
          input.tenant_id,
          input.entity_type,
          input.entity_id,
        ],
      );

      return result.rows[0] ?? null;
    },

    async hasProcessedEvent(consumerName: string, eventId: string) {
      const result = await db.query<{ found: number }>(
        `select 1 as found
         from projection_event_applications
         where consumer_name = $1
           and event_id = $2`,
        [consumerName, eventId],
      );

      return result.rows.length > 0;
    },

    async insertDeadLetter(input: ProjectionDeadLetterInput) {
      const result = await db.query<ProjectionDeadLetterRow>(
        `insert into projection_dead_letters (
          consumer_name,
          topic,
          partition,
          kafka_offset,
          event_id,
          event_type,
          tenant_id,
          trace_id,
          failure_reason,
          payload
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        returning *`,
        [
          input.consumer_name,
          input.topic,
          input.partition,
          input.kafka_offset,
          input.event_id,
          input.event_type,
          input.tenant_id,
          input.trace_id,
          input.failure_reason,
          JSON.stringify(input.payload),
        ],
      );

      return result.rows[0];
    },

    async clearProjectionState() {
      await db.query(`truncate projection_event_applications`);
      await db.query(`truncate projection_dead_letters`);
    },
  };
}

export function createCustomerContextViewRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, customerId: string) {
      const result = await db.query<CustomerContextViewRow>(
        `select * from customer_context_view where tenant_id = $1 and customer_id = $2`,
        [tenantId, customerId],
      );

      return result.rows[0] ?? null;
    },

    async findByIds(tenantId: string, customerIds: string[]) {
      if (customerIds.length === 0) {
        return [];
      }

      const result = await db.query<CustomerContextViewRow>(
        `select *
         from customer_context_view
         where tenant_id = $1
           and customer_id = any($2::uuid[])`,
        [tenantId, customerIds],
      );

      return result.rows;
    },

    async upsert(input: Omit<CustomerContextViewRow, 'projection_updated_at'>) {
      const result = await db.query<CustomerContextViewRow>(
        `insert into customer_context_view (
          tenant_id,
          customer_id,
          external_ref,
          email,
          full_name,
          status,
          customer_metadata,
          source_event_id,
          source_event_version,
          source_occurred_at
        ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
        on conflict (tenant_id, customer_id)
        do update set
          external_ref = excluded.external_ref,
          email = excluded.email,
          full_name = excluded.full_name,
          status = excluded.status,
          customer_metadata = excluded.customer_metadata,
          source_event_id = excluded.source_event_id,
          source_event_version = excluded.source_event_version,
          source_occurred_at = excluded.source_occurred_at,
          projection_updated_at = now()
        where customer_context_view.source_occurred_at <= excluded.source_occurred_at
        returning *`,
        [
          input.tenant_id,
          input.customer_id,
          input.external_ref,
          input.email,
          input.full_name,
          input.status,
          JSON.stringify(input.customer_metadata),
          input.source_event_id,
          input.source_event_version,
          input.source_occurred_at,
        ],
      );

      return result.rows[0] ?? null;
    },

    async truncate() {
      await db.query(`truncate customer_context_view`);
    },
  };
}

export function createOrderContextViewRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, orderId: string) {
      const result = await db.query<OrderContextViewRow>(
        `select * from order_context_view where tenant_id = $1 and order_id = $2`,
        [tenantId, orderId],
      );

      return result.rows[0] ?? null;
    },

    async findByIds(tenantId: string, orderIds: string[]) {
      if (orderIds.length === 0) {
        return [];
      }

      const result = await db.query<OrderContextViewRow>(
        `select *
         from order_context_view
         where tenant_id = $1
           and order_id = any($2::uuid[])`,
        [tenantId, orderIds],
      );

      return result.rows;
    },

    async listByCustomerId(tenantId: string, customerId: string, limit: number) {
      const result = await db.query<OrderContextViewRow>(
        `select *
         from order_context_view
         where tenant_id = $1
           and customer_id = $2
         order by projection_updated_at desc
         limit $3`,
        [tenantId, customerId, limit],
      );

      return result.rows;
    },

    async upsert(input: Omit<OrderContextViewRow, 'projection_updated_at'>) {
      const result = await db.query<OrderContextViewRow>(
        `insert into order_context_view (
          tenant_id,
          order_id,
          customer_id,
          order_number,
          status,
          amount_cents,
          currency,
          order_metadata,
          source_event_id,
          source_event_version,
          source_occurred_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        on conflict (tenant_id, order_id)
        do update set
          customer_id = excluded.customer_id,
          order_number = excluded.order_number,
          status = excluded.status,
          amount_cents = excluded.amount_cents,
          currency = excluded.currency,
          order_metadata = excluded.order_metadata,
          source_event_id = excluded.source_event_id,
          source_event_version = excluded.source_event_version,
          source_occurred_at = excluded.source_occurred_at,
          projection_updated_at = now()
        where order_context_view.source_occurred_at <= excluded.source_occurred_at
        returning *`,
        [
          input.tenant_id,
          input.order_id,
          input.customer_id,
          input.order_number,
          input.status,
          input.amount_cents,
          input.currency,
          JSON.stringify(input.order_metadata),
          input.source_event_id,
          input.source_event_version,
          input.source_occurred_at,
        ],
      );

      return result.rows[0] ?? null;
    },

    async truncate() {
      await db.query(`truncate order_context_view`);
    },
  };
}

export function createAgentSessionContextViewRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, sessionId: string) {
      const result = await db.query<AgentSessionContextViewRow>(
        `select * from agent_session_context_view where tenant_id = $1 and agent_session_id = $2`,
        [tenantId, sessionId],
      );

      return result.rows[0] ?? null;
    },

    async findByIds(tenantId: string, sessionIds: string[]) {
      if (sessionIds.length === 0) {
        return [];
      }

      const result = await db.query<AgentSessionContextViewRow>(
        `select *
         from agent_session_context_view
         where tenant_id = $1
           and agent_session_id = any($2::uuid[])`,
        [tenantId, sessionIds],
      );

      return result.rows;
    },

    async listByCustomerId(tenantId: string, customerId: string, limit: number) {
      const result = await db.query<AgentSessionContextViewRow>(
        `select *
         from agent_session_context_view
         where tenant_id = $1
           and customer_id = $2
         order by projection_updated_at desc
         limit $3`,
        [tenantId, customerId, limit],
      );

      return result.rows;
    },

    async listByOrderId(tenantId: string, orderId: string, limit: number) {
      const result = await db.query<AgentSessionContextViewRow>(
        `select *
         from agent_session_context_view
         where tenant_id = $1
           and order_id = $2
         order by projection_updated_at desc
         limit $3`,
        [tenantId, orderId, limit],
      );

      return result.rows;
    },

    async upsert(input: Omit<AgentSessionContextViewRow, 'projection_updated_at'>) {
      const result = await db.query<AgentSessionContextViewRow>(
        `insert into agent_session_context_view (
          tenant_id,
          agent_session_id,
          customer_id,
          order_id,
          status,
          channel,
          last_context_request_id,
          last_context_query_text,
          last_context_scope,
          last_response_id,
          last_response_model,
          last_response_token_count,
          session_summary,
          source_event_id,
          source_event_version,
          source_occurred_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14, $15, $16)
        on conflict (tenant_id, agent_session_id)
        do update set
          customer_id = excluded.customer_id,
          order_id = excluded.order_id,
          status = excluded.status,
          channel = excluded.channel,
          last_context_request_id = excluded.last_context_request_id,
          last_context_query_text = excluded.last_context_query_text,
          last_context_scope = excluded.last_context_scope,
          last_response_id = excluded.last_response_id,
          last_response_model = excluded.last_response_model,
          last_response_token_count = excluded.last_response_token_count,
          session_summary = excluded.session_summary,
          source_event_id = excluded.source_event_id,
          source_event_version = excluded.source_event_version,
          source_occurred_at = excluded.source_occurred_at,
          projection_updated_at = now()
        where agent_session_context_view.source_occurred_at <= excluded.source_occurred_at
        returning *`,
        [
          input.tenant_id,
          input.agent_session_id,
          input.customer_id,
          input.order_id,
          input.status,
          input.channel,
          input.last_context_request_id,
          input.last_context_query_text,
          JSON.stringify(input.last_context_scope),
          input.last_response_id,
          input.last_response_model,
          input.last_response_token_count,
          JSON.stringify(input.session_summary),
          input.source_event_id,
          input.source_event_version,
          input.source_occurred_at,
        ],
      );

      return result.rows[0] ?? null;
    },

    async truncate() {
      await db.query(`truncate agent_session_context_view`);
    },
  };
}

export function createAgentAuditLogRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, auditLogId: string) {
      const result = await db.query<AgentAuditLogRow>(
        `select *
         from agent_audit_logs
         where tenant_id = $1
           and id = $2`,
        [tenantId, auditLogId],
      );

      return result.rows[0] ?? null;
    },

    async listRecentByEntity(
      tenantId: string,
      entityType: string,
      entityId: string,
      limit: number,
    ) {
      const result = await db.query<ContextAuditReferenceRow>(
        `select
           id,
           tenant_id,
           agent_session_id,
           event_type,
           actor_id,
           entity_type,
           entity_id,
           trace_id,
           occurred_at,
           created_at,
           payload as payload_summary
         from agent_audit_logs
         where tenant_id = $1
           and entity_type = $2
           and entity_id = $3
         order by occurred_at desc, created_at desc
         limit $4`,
        [tenantId, entityType, entityId, limit],
      );

      return result.rows;
    },

    async listRecentBySessionId(tenantId: string, sessionId: string, limit: number) {
      const result = await db.query<ContextAuditReferenceRow>(
        `select
           id,
           tenant_id,
           agent_session_id,
           event_type,
           actor_id,
           entity_type,
           entity_id,
           trace_id,
           occurred_at,
           created_at,
           payload as payload_summary
         from agent_audit_logs
         where tenant_id = $1
           and agent_session_id = $2
         order by occurred_at desc, created_at desc
         limit $3`,
        [tenantId, sessionId, limit],
      );

      return result.rows;
    },
  };
}

export function createRepositoryContext(db: SqlExecutor) {
  return {
    customers: createCustomerRepository(db),
    orders: createOrderRepository(db),
    agentSessions: createAgentSessionRepository(db),
    ingestionRequests: createIngestionRequestRepository(db),
    idempotencyKeys: createIdempotencyRepository(db),
    outbox: createOutboxRepository(db),
    projectionState: createProjectionStateRepository(db),
    customerContextView: createCustomerContextViewRepository(db),
    orderContextView: createOrderContextViewRepository(db),
    agentSessionContextView: createAgentSessionContextViewRepository(db),
    agentAuditLogs: createAgentAuditLogRepository(db),
  };
}

export type RepositoryContext = ReturnType<typeof createRepositoryContext>;
export type SupportedOutboxEventName = EventName;
