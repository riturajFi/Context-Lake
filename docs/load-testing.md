# Load Testing

## Scope

The repository includes simple developer-runnable load scripts for:

- `ingest-api`
- `context-query-api`

These scripts are intended for local and pre-production signal gathering, not for formal capacity certification.

## Commands

Run the ingest path load test:

```bash
pnpm load:ingest
```

Run the context read path load test:

```bash
pnpm load:context
```

Environment variables:

- `LOAD_TOTAL_REQUESTS`
- `LOAD_CONCURRENCY`
- `LOAD_TEST_TOKEN`
- `LOAD_TEST_TENANT_ID`
- `INGEST_API_BASE_URL`
- `CONTEXT_QUERY_API_BASE_URL`
- `LOAD_CUSTOMER_ID`

## Metrics Reported

Each script prints JSON with:

- `throughput_rps`
- `p50_ms`
- `p95_ms`
- `error_rate_percent`

Example:

```json
{
  "test": "context-query-api",
  "total_requests": 200,
  "concurrency": 20,
  "throughput_rps": 318.42,
  "p50_ms": 22.1,
  "p95_ms": 61.3,
  "error_rate_percent": 0
}
```

## Lag Under Load

The load scripts do not calculate Kafka lag directly. Use service metrics and Kafka UI while the test is running:

- `curl -s http://localhost:3004/metrics | grep stream_processor_consumer_lag`
- `curl -s http://localhost:3003/metrics | grep audit_writer_consumer_lag`
- `curl -s http://localhost:3001/metrics | grep outbox`
- Kafka UI at `http://localhost:8080`

## Reliability Exercises

Recommended manual drills during or immediately after a load run:

1. Stop Kafka briefly and confirm outbox backlog grows while request-side DB writes still complete.
2. Restart the stream processor and confirm projection dedupe prevents duplicate row application.
3. Restart Postgres and confirm readiness endpoints fail fast until dependencies recover.

These drills complement the automated resilience tests already in the repo.

## Reading Results Honestly

- Local Docker results are host-dependent.
- The current load driver is intentionally simple and does not model long-lived keepalive pools or mixed workloads.
- Use these runs to compare relative changes between commits, not to claim production capacity.
