# Event Catalog

## Topics

| Topic | Purpose | Partition Key Guidance |
| --- | --- | --- |
| `customer-events` | Customer lifecycle events consumed by downstream read models and integrations. | `tenant_id:customer_id` |
| `order-events` | Order lifecycle events with entity ordering guarantees per order. | `tenant_id:order_id` |
| `agent-events` | Agent session activity and context interaction events. | `tenant_id:agent_session_id` |
| `audit-events` | Durable audit notifications for compliance and forensic replay. | `tenant_id:entity_type:entity_id` |

## Envelope

Every event uses the shared versioned envelope in `@context-lake/shared-events` with these required fields:

- `event_id`
- `event_type`
- `event_version`
- `tenant_id`
- `trace_id`
- `actor_id` optional
- `entity_type`
- `entity_id`
- `occurred_at`
- `produced_at`
- `source`
- `idempotency_key` optional
- `payload`

All timestamps are ISO-8601 UTC strings ending in `Z`.

## Events

| Event Name | Topic | Entity | Purpose |
| --- | --- | --- | --- |
| `customer.created` | `customer-events` | `customer` | New customer record accepted into the system. |
| `customer.updated` | `customer-events` | `customer` | Mutable customer fields changed. |
| `order.created` | `order-events` | `order` | New order persisted. |
| `order.status_changed` | `order-events` | `order` | Order lifecycle status transitioned. |
| `agent.session.started` | `agent-events` | `agent_session` | Agent session opened. |
| `agent.context.requested` | `agent-events` | `agent_session` | Agent requested context from the engine. |
| `agent.response.generated` | `agent-events` | `agent_session` | Agent produced a response after context retrieval. |
| `audit.recorded` | `audit-events` | `agent_audit_event` | Durable audit log entry was recorded. |

## Versioning Guidance

- Start every v1 contract at `event_version = 1`.
- Additive payload changes should increment version only when consumers need an explicit compatibility boundary.
- Breaking changes should create a new versioned schema and keep prior versions parseable until consumers are migrated.
