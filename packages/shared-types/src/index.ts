export type ServiceName =
  | 'ingest-api'
  | 'context-query-api'
  | 'stream-processor'
  | 'audit-writer';

export type EntityType =
  | 'customer'
  | 'order'
  | 'agent_session'
  | 'agent_audit_event'
  | 'ingestion_request'
  | 'outbox_event'
  | 'idempotency_key';

export type TopicName =
  | 'customer-events'
  | 'order-events'
  | 'agent-events'
  | 'audit-events';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: ServiceName;
  checks: Record<string, 'up' | 'down'>;
  timestamp: string;
}
