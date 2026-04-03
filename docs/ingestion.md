# Ingestion v1

## Endpoints

### `POST /ingest/customer`

Headers:

- `x-tenant-id: <uuid>`
- `idempotency-key: <stable client key>`
- `x-request-id: <optional trace id>`
- `x-actor-id: <optional uuid>`

Body:

```json
{
  "external_ref": "cust-ext-001",
  "email": "customer@example.com",
  "full_name": "Ada Lovelace",
  "status": "active",
  "metadata": {
    "source_system": "crm"
  }
}
```

### `POST /ingest/order`

Body:

```json
{
  "customer_id": "11111111-1111-4111-8111-111111111111",
  "order_number": "ORD-1001",
  "status": "confirmed",
  "amount_cents": 1299,
  "currency": "USD",
  "metadata": {
    "channel": "checkout"
  }
}
```

### `POST /ingest/agent-session`

Body:

```json
{
  "customer_id": "11111111-1111-4111-8111-111111111111",
  "order_id": "22222222-2222-4222-8222-222222222222",
  "status": "active",
  "channel": "api",
  "context_summary": {
    "entrypoint": "assistant"
  }
}
```

## Response

Accepted or duplicate responses return:

```json
{
  "request_id": "44444444-4444-4444-8444-444444444444",
  "resource_id": "11111111-1111-4111-8111-111111111111",
  "resource_type": "customer",
  "event_id": "77777777-7777-4777-8777-777777777777",
  "outbox_status": "pending",
  "duplicate": false,
  "trace_id": "trace-123",
  "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

## Request Lifecycle

1. API validates headers and payload.
2. API opens a database transaction.
3. API checks for an existing idempotency record.
4. API writes the domain row.
5. API writes the outbox row.
6. API writes the ingestion request record.
7. API writes the idempotency ledger row.
8. Transaction commits and the API returns `202 Accepted`.
9. Background relay polls claimable outbox rows.
10. Relay publishes to Kafka.
11. Relay marks the row `published` on success or `failed` with `last_error` and a delayed `available_at` on failure.

## Practical Guarantees

- Source-of-truth writes and outbox writes are atomic inside one database transaction.
- Duplicate request bodies with the same idempotency key return the original resource reference instead of creating a second domain write.
- Publish retries are safe because only committed outbox rows are published.
- This is not strict end-to-end exactly-once delivery across Postgres and Kafka.
- If Kafka publish succeeds and the subsequent status update fails, the row can be retried and published again.
- Consumers must still deduplicate on `event_id`.

## Failure Visibility

- API returns stable JSON errors with `code`, `message`, and `trace_id`.
- Failed outbox rows keep `publish_status = 'failed'`, `last_error`, and a future `available_at`.
- `GET /health` reports dependency checks plus ingestion/outbox counters.

## Topic Message Example

```json
{
  "event_id": "77777777-7777-4777-8777-777777777777",
  "event_type": "customer.created",
  "event_version": 1,
  "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "trace_id": "trace-123",
  "entity_type": "customer",
  "entity_id": "11111111-1111-4111-8111-111111111111",
  "occurred_at": "2026-04-03T12:00:00.000Z",
  "produced_at": "2026-04-03T12:00:00.000Z",
  "source": "ingest-api",
  "idempotency_key": "customer-req-001",
  "payload": {
    "customer_id": "11111111-1111-4111-8111-111111111111",
    "external_ref": "cust-ext-001",
    "email": "customer@example.com",
    "full_name": "Ada Lovelace",
    "status": "active"
  }
}
```
