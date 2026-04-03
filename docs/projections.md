# Projection Semantics

## Source Topics

| Topic | Consumed Events | Partition Key Assumption |
| --- | --- | --- |
| `customer-events` | `customer.created`, `customer.updated` | Ordering is only assumed within `tenant_id:customer_id`. |
| `order-events` | `order.created`, `order.status_changed` | Ordering is only assumed within `tenant_id:order_id`. |
| `agent-events` | `agent.session.started`, `agent.context.requested`, `agent.response.generated` | Ordering is only assumed within `tenant_id:agent_session_id`. |

## Target Tables

| Table | Source Events | Purpose |
| --- | --- | --- |
| `customer_context_view` | customer events | Fast tenant-scoped customer lookup and status reads. |
| `order_context_view` | order events | Fast order status reads and customer-linked order queries. |
| `agent_session_context_view` | agent events | Fast agent session summary reads with latest context request and response state. |

## Idempotency Rules

- Projection dedupe is enforced by `projection_event_applications (consumer_name, event_id)`.
- Re-delivered Kafka events with the same `event_id` are ignored after the first successful application.
- Poison messages are written to `projection_dead_letters`.

## Out-Of-Order Strategy

- The processor assumes ordering only within a topic partition key.
- Each projection row stores `source_occurred_at`.
- If a later-delivered event is older than the row’s current `source_occurred_at`, the event is ignored.
- This is conservative and favors projection stability over reconstructing a perfect historical merge for late events.

## Replay Strategy

- Runtime mode can start consumption with `PROJECTION_REPLAY_FROM_BEGINNING=true`.
- Local replay script clears projection tables and the dedupe ledger, then starts consumption from earliest offsets.
- Kafka offsets are used as the source of truth for replay position.
- The database only stores dedupe state and dead-letter records, not a separate consumer offset checkpoint.

## Consumer Progress Choice

The processor relies on Kafka consumer group offsets for runtime progress. This keeps operational state aligned with Kafka and avoids a second checkpoint mechanism. The database stores:

- dedupe state: `projection_event_applications`
- poison event records: `projection_dead_letters`

## Schema Version Handling

- Only `event_version = 1` is accepted by the current validators.
- Version mismatches fail validation and are dead-lettered.
- The processor increments `failed_projection_count` for those messages.

## Example Sequence

1. `order.created` arrives for `tenant_id:order_id`.
2. `order_context_view` upserts the base row with `status = pending`.
3. `order.status_changed` arrives later for the same partition key.
4. `order_context_view` upserts the same row with `status = confirmed`.
5. `source_event_id` and `source_occurred_at` move forward to the newer event.
