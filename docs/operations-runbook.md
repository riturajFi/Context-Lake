# Operations Runbook

## Local Startup

1. Install dependencies:

```bash
pnpm install
```

2. Copy environment files:

```bash
bash infra/scripts/copy-env.sh
```

3. Start infrastructure and observability:

```bash
pnpm compose:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Inspect Failures

### Ingest failures

```bash
psql "$POSTGRES_URL" -c "select event_id, publish_status, attempt_count, last_error, request_id, trace_id from outbox_events order by created_at desc limit 20"
```

### Projection failures

```bash
psql "$POSTGRES_URL" -c "select id, topic, event_id, failure_reason, created_at from projection_dead_letters order by created_at desc limit 20"
```

### Audit pipeline failures

```bash
curl -s http://localhost:3003/metrics | grep audit_writer_events_processed_total
```

## Trace A Request

1. Capture the `x-request-id` and `x-trace-id` from the API response.
2. Inspect audit rows:

```bash
psql "$POSTGRES_URL" -c "select id, request_id, trace_id, service_name, event_type, entity_type, entity_id, occurred_at from agent_audit_logs where request_id = '<REQUEST_ID>' order by occurred_at asc"
```

3. Inspect outbox rows:

```bash
psql "$POSTGRES_URL" -c "select event_id, request_id, trace_id, topic, publish_status, published_at from outbox_events where request_id = '<REQUEST_ID>' order by created_at asc"
```

4. Open Jaeger:

- `http://localhost:16686`

Search by trace ID copied from the API response.

## Inspect Lag

### Stream processor lag

```bash
curl -s http://localhost:3004/metrics | grep stream_processor_consumer_lag
```

### Audit writer lag

```bash
curl -s http://localhost:3003/metrics | grep audit_writer_consumer_lag
```

### Kafka UI

- `http://localhost:8080`

Inspect consumer groups:

- `context-lake-stream-processor`
- `context-lake-audit-writer`

## Inspect Audit Logs

Recent audit entries by tenant:

```bash
psql "$POSTGRES_URL" -c "select id, request_id, trace_id, service_name, event_type, actor_id, entity_type, entity_id, occurred_at from agent_audit_logs where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' order by occurred_at desc limit 20"
```

Audit rows are append-only in application behavior. Dedupe is enforced on `source_event_id` when an upstream Kafka event is replayed.

## Metrics And Dashboards

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3005`
- Jaeger: `http://localhost:16686`

Service metrics endpoints:

- `http://localhost:3001/metrics`
- `http://localhost:3002/metrics`
- `http://localhost:3003/metrics`
- `http://localhost:3004/metrics`
