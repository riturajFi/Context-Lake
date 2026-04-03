# Context Query API

`context-query-api` serves low-latency, tenant-scoped read models built by `stream-processor`.

## Endpoints

### `GET /context/customer/:customerId`

Returns the current customer context, recent related orders, recent related agent sessions, and recent audit references.

Headers:

- `x-tenant-id`: required UUID
- `x-request-id`: optional request correlation ID

Query params:

- `audit_limit`: optional integer, default `5`, max `20`
- `related_limit`: optional integer, default `5`, max `25`

### `GET /context/order/:orderId`

Returns the current order context, the current customer projection for the order, recent related agent sessions, and recent audit references.

### `GET /context/agent-session/:sessionId`

Returns the current agent session context, the linked customer and order projections when present, and recent audit references for the session.

### `POST /context/batch`

Fetches multiple contexts in one request. This route is intentionally capped to `10` items to keep fan-out bounded and response latency predictable.

Request body:

```json
{
  "items": [
    {
      "entity_type": "customer",
      "entity_id": "11111111-1111-4111-8111-111111111111"
    },
    {
      "entity_type": "order",
      "entity_id": "22222222-2222-4222-8222-222222222222"
    }
  ],
  "audit_limit": 3,
  "related_limit": 3
}
```

## Response Shape

All successful responses include:

- `trace_id`: request correlation ID
- `tenant_id`: enforced from `x-tenant-id`
- `entity_type`: top-level context type

Projection-backed entities include:

- current state from the materialized view
- `history` metadata from the source event that last updated the projection
- `audit_references` with lightweight payload summary fields

Example `GET /context/order/:orderId` response:

```json
{
  "trace_id": "trace-order-read-001",
  "tenant_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "entity_type": "order",
  "order": {
    "order_id": "22222222-2222-4222-8222-222222222222",
    "customer_id": "11111111-1111-4111-8111-111111111111",
    "order_number": "ORD-1001",
    "status": "confirmed",
    "amount_cents": 1299,
    "currency": "USD",
    "metadata": {
      "channel": "checkout"
    },
    "history": {
      "source_event_id": "90000000-0000-4000-8000-000000000002",
      "source_event_version": 1,
      "source_occurred_at": "2026-04-03T10:02:00.000Z",
      "projection_updated_at": "2026-04-03T10:02:00.000Z"
    }
  },
  "related": {
    "customer": {
      "customer_id": "11111111-1111-4111-8111-111111111111",
      "external_ref": "cust-ext-001",
      "email": "ada@example.com",
      "full_name": "Ada Lovelace",
      "status": "active",
      "metadata": {
        "segment": "enterprise"
      },
      "history": {
        "source_event_id": "90000000-0000-4000-8000-000000000001",
        "source_event_version": 1,
        "source_occurred_at": "2026-04-03T10:00:00.000Z",
        "projection_updated_at": "2026-04-03T10:00:00.000Z"
      }
    },
    "recent_agent_sessions": [
      {
        "session_id": "33333333-3333-4333-8333-333333333333",
        "customer_id": "11111111-1111-4111-8111-111111111111",
        "order_id": "22222222-2222-4222-8222-222222222222",
        "status": "active",
        "channel": "api",
        "last_context_request_id": "44444444-4444-4444-8444-444444444444",
        "last_context_query_text": "summarize order status",
        "last_context_scope": ["customer", "order"],
        "last_response_id": "55555555-5555-4555-8555-555555555555",
        "last_response_model": "gpt-5.4",
        "last_response_token_count": 431,
        "session_summary": {
          "phase": "assist"
        },
        "history": {
          "source_event_id": "90000000-0000-4000-8000-000000000003",
          "source_event_version": 1,
          "source_occurred_at": "2026-04-03T10:03:00.000Z",
          "projection_updated_at": "2026-04-03T10:03:00.000Z"
        }
      }
    ]
  },
  "audit_references": [
    {
      "audit_id": "77777777-7777-4777-8777-777777777777",
      "event_type": "audit.recorded",
      "actor_id": null,
      "trace_id": "trace-order-001",
      "occurred_at": "2026-04-03T10:05:00.000Z",
      "created_at": "2026-04-03T10:05:00.000Z",
      "agent_session_id": "33333333-3333-4333-8333-333333333333",
      "entity_type": "order",
      "entity_id": "22222222-2222-4222-8222-222222222222",
      "payload_summary": {
        "message": "order confirmed",
        "severity": "info"
      }
    }
  ]
}
```

## Request Flow

1. Fastify accepts the request and generates or propagates `x-request-id`.
2. `context-query-api` validates the path, query string, body, and required `x-tenant-id`.
3. The service layer issues tenant-scoped reads against:
   - `customer_context_view`
   - `order_context_view`
   - `agent_session_context_view`
   - `agent_audit_logs`
4. Rows are reshaped into agent-oriented context objects with bounded related lists.
5. The response returns the current state plus audit references and projection history metadata.

## Table Usage

- `customer_context_view`: current customer state keyed by `(tenant_id, customer_id)`
- `order_context_view`: current order state keyed by `(tenant_id, order_id)`
- `agent_session_context_view`: current agent session state keyed by `(tenant_id, agent_session_id)`
- `agent_audit_logs`: recent human-readable references tied to an entity or session

## Performance Notes

- Query paths are tenant-scoped by server-side predicates.
- Embedded lists are capped to prevent unbounded fan-out.
- Added audit indexes in `004_context_query_indexes.sql` for recent entity and session lookups.
- Slow requests and query operations are logged with `trace_id`.

## Stable Errors

Validation and not-found failures use a stable envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "order context not found",
    "trace_id": "trace-order-read-001"
  }
}
```
