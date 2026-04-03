import type { EventEnvelope, EventName } from '@context-lake/shared-events';
import type { TopicName } from '@context-lake/shared-types';

import type { SqlExecutor } from './client.js';
import type {
  CustomerRow,
  IdempotencyKeyRow,
  IngestionRequestRow,
  OrderRow,
  OutboxEventRow,
} from './types.js';

export function createCustomerRepository(db: SqlExecutor) {
  return {
    async findById(tenantId: string, customerId: string) {
      const result = await db.query<CustomerRow>(
        `select * from customers where tenant_id = $1 and id = $2`,
        [tenantId, customerId],
      );

      return result.rows[0] ?? null;
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
  };
}

export function createRepositoryContext(db: SqlExecutor) {
  return {
    customers: createCustomerRepository(db),
    orders: createOrderRepository(db),
    ingestionRequests: createIngestionRequestRepository(db),
    idempotencyKeys: createIdempotencyRepository(db),
    outbox: createOutboxRepository(db),
  };
}

export type RepositoryContext = ReturnType<typeof createRepositoryContext>;
export type SupportedOutboxEventName = EventName;
