# Data Model

## ER Summary

- A `Customer` belongs to one tenant and can have many `Order` rows.
- An `Order` belongs to one tenant and one `Customer`.
- An `AgentSession` belongs to one tenant and may optionally reference a `Customer` and an `Order`.
- An `AgentAuditLog` belongs to one tenant and may optionally reference an `AgentSession`.
- An `IngestionRequest` belongs to one tenant and may reserve an idempotency key.
- An `IdempotencyKey` belongs to one tenant and enforces request deduplication within a scope.
- An `OutboxEvent` belongs to one tenant and stores publishable event envelopes for reliable downstream delivery.

## Table Purpose

| Table | Purpose |
| --- | --- |
| `customers` | Canonical tenant-scoped customer records. |
| `orders` | Canonical tenant-scoped orders linked to customers. |
| `agent_sessions` | Session-level tracking for agent runs and context activity. |
| `agent_audit_logs` | Immutable audit entries for agent and entity actions. |
| `ingestion_requests` | Durable record of inbound ingestion requests and their lifecycle state. |
| `idempotency_keys` | Tenant-scoped deduplication ledger keyed by logical scope. |
| `outbox_events` | Reliable publication buffer for events awaiting broker delivery. |
| `schema_migrations` | Applied migration ledger used by the migration runner. |

## Keying Strategy

- All primary business entities use UUID primary keys.
- Every business table is tenant-scoped with a required `tenant_id` UUID.
- Idempotency is enforced with unique constraints on `idempotency_keys (tenant_id, scope, idempotency_key)` and on `ingestion_requests (tenant_id, idempotency_key)` when present.
- Outbox uniqueness is enforced by `event_id`, which maps directly to event metadata `event_id`.
- Ordering-sensitive topics use stable partition keys derived from `tenant_id` plus the primary entity identifier.

## Index Strategy

- Tenant plus creation time indexes support list and audit views.
- Tenant plus entity indexes support direct entity lookups.
- Partial idempotency indexes avoid duplicate reservation of request keys.
- Outbox processing uses a partial index on `publish_status`, `available_at`, and `created_at` for efficient polling of ready work.

## Timestamp Conventions

- Database timestamps use `timestamptz`.
- Application event envelopes require UTC ISO-8601 strings with `Z`.
- Application writes should always pass UTC timestamps explicitly when not using database defaults.
