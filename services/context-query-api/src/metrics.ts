export class ContextQueryMetrics {
  private contextRequestsTotal = 0;
  private notFoundTotal = 0;
  private batchRequestsTotal = 0;
  private slowRequestsTotal = 0;
  private totalRequestDurationMs = 0;
  private lastRequestDurationMs = 0;

  incrementContextRequests() {
    this.contextRequestsTotal += 1;
  }

  incrementBatchRequests() {
    this.batchRequestsTotal += 1;
  }

  incrementNotFound() {
    this.notFoundTotal += 1;
  }

  incrementSlowRequests() {
    this.slowRequestsTotal += 1;
  }

  recordRequestDuration(durationMs: number) {
    this.totalRequestDurationMs += durationMs;
    this.lastRequestDurationMs = durationMs;
  }

  snapshot() {
    const totalRequests = this.contextRequestsTotal + this.batchRequestsTotal;

    return {
      context_requests_total: this.contextRequestsTotal,
      context_batch_requests_total: this.batchRequestsTotal,
      context_not_found_total: this.notFoundTotal,
      slow_requests_total: this.slowRequestsTotal,
      last_request_duration_ms: this.lastRequestDurationMs,
      average_request_duration_ms:
        totalRequests === 0 ? 0 : Number((this.totalRequestDurationMs / totalRequests).toFixed(2)),
    };
  }
}
