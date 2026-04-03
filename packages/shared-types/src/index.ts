export type ServiceName =
  | 'ingest-api'
  | 'context-query-api'
  | 'stream-processor'
  | 'audit-writer';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: ServiceName;
  checks: Record<string, 'up' | 'down'>;
  timestamp: string;
}
