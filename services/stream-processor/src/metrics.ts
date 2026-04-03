import type { ProjectionMetricsSnapshot } from './types.js';

export class ProjectionMetrics {
  private consumerLag = 0;
  private projectionUpdateLatencyMs = 0;
  private failedProjectionCount = 0;

  setConsumerLag(value: number) {
    this.consumerLag = value;
  }

  setProjectionUpdateLatencyMs(value: number) {
    this.projectionUpdateLatencyMs = value;
  }

  incrementFailedProjectionCount() {
    this.failedProjectionCount += 1;
  }

  snapshot(): ProjectionMetricsSnapshot {
    return {
      consumer_lag: this.consumerLag,
      projection_update_latency_ms: this.projectionUpdateLatencyMs,
      failed_projection_count: this.failedProjectionCount,
    };
  }
}
