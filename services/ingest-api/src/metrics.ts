export interface IngestionMetricsSnapshot {
  ingestion_requests_total: number;
  outbox_publish_success_total: number;
  outbox_publish_failure_total: number;
  outbox_pending_count: number;
  auth_failures_total: number;
}

export class IngestionMetrics {
  private ingestionRequestsTotal = 0;
  private publishSuccessTotal = 0;
  private publishFailureTotal = 0;
  private outboxPendingCount = 0;
  private authFailuresTotal = 0;

  incrementIngestionRequests() {
    this.ingestionRequestsTotal += 1;
  }

  incrementPublishSuccess() {
    this.publishSuccessTotal += 1;
  }

  incrementPublishFailure() {
    this.publishFailureTotal += 1;
  }

  setOutboxPendingCount(count: number) {
    this.outboxPendingCount = count;
  }

  incrementAuthFailures() {
    this.authFailuresTotal += 1;
  }

  snapshot(): IngestionMetricsSnapshot {
    return {
      ingestion_requests_total: this.ingestionRequestsTotal,
      outbox_publish_success_total: this.publishSuccessTotal,
      outbox_publish_failure_total: this.publishFailureTotal,
      outbox_pending_count: this.outboxPendingCount,
      auth_failures_total: this.authFailuresTotal,
    };
  }
}
