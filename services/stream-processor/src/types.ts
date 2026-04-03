import type { EventEnvelope } from '@context-lake/shared-events';

export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: string;
  value: string;
}

export interface ProjectionMetricsSnapshot {
  consumer_lag: number;
  projection_update_latency_ms: number;
  failed_projection_count: number;
}

export interface ProjectionConsumerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ProjectionContext {
  consumerName: string;
  topic: string;
  partition: number;
  offset: string;
  event: EventEnvelope;
}
