# Context Lake Architecture

## Purpose

Context Lake is a multi-tenant, event-driven context engine for AI agents. The current v1 repository provides the core ingestion, eventing, projection, query, audit, and observability paths needed to run the platform locally and to reason honestly about production deployment.

This document summarizes the current architecture. It does not claim that the local Compose stack is production-ready.

## Services

- `ingest-api`
  - Accepts external write requests.
  - Validates tenant, auth, request body, and idempotency key.
  - Writes source-of-truth rows and outbox rows in one Postgres transaction.
  - Runs an outbox relay that publishes Kafka events and updates publication status.
- `stream-processor`
  - Consumes domain topics from Kafka.
  - Validates event envelopes.
  - Applies idempotent projection updates into denormalized context tables.
  - Stores poison events in a dead-letter table.
- `context-query-api`
  - Serves governed, tenant-scoped context responses from materialized views.
  - Emits audit events when context is accessed.
  - Exposes bounded related data and audit references rather than raw table dumps.
- `audit-writer`
  - Consumes `audit-events` and selected `agent-events`.
  - Persists append-only audit rows for compliance review and traceability.
- `presentation-web`
  - Serves a demo-ready frontend for walkthroughs and architecture reviews.
  - Aggregates local service liveness and readiness into a single presentable screen.

## Shared Packages

- `@context-lake/shared-config`
  - Environment loading and validation.
  - Dependency reachability checks.
- `@context-lake/shared-db`
  - DB pool creation, migrations, typed repositories, and projection helpers.
- `@context-lake/shared-events`
  - Versioned event envelopes, event catalog, topic mapping, and Kafka publisher abstraction.
- `@context-lake/shared-http`
  - Fastify bootstrap, auth and tenant governance, request context, shared API errors, and metrics endpoint wiring.
- `@context-lake/shared-logging`
  - Structured JSON logging and redaction rules.
- `@context-lake/shared-observability`
  - Prometheus registry helpers and OpenTelemetry bootstrap helpers.

## Kafka Topics

- `customer-events`
  - Customer lifecycle events.
  - Partition key guidance: `tenant_id:customer_id`
- `order-events`
  - Order lifecycle events.
  - Partition key guidance: `tenant_id:order_id`
- `agent-events`
  - Agent session, context request, and response generation events.
  - Partition key guidance: `tenant_id:agent_session_id`
- `audit-events`
  - Durable audit records emitted by API and workflow paths.
  - Partition key guidance: `tenant_id:entity_type:entity_id`

## Primary Tables

Source-of-truth tables:

- `customers`
- `orders`
- `agent_sessions`
- `ingestion_requests`
- `idempotency_keys`
- `outbox_events`

Audit and compliance tables:

- `agent_audit_logs`

Projection and replay tables:

- `customer_context_view`
- `order_context_view`
- `agent_session_context_view`
- `projection_event_applications`
- `projection_dead_letters`

Migration tracking:

- `schema_migrations`

## Request Paths

### Ingestion path

1. Client sends a request to `ingest-api` with auth, `x-tenant-id`, `x-request-id`, optional `x-trace-id`, and `idempotency-key`.
2. `ingest-api` validates headers and body.
3. Service layer writes:
   - domain row
   - `ingestion_requests` row
   - `idempotency_keys` row
   - `outbox_events` row
4. The outbox relay polls pending rows and publishes to Kafka.
5. Publication success or failure is written back to `outbox_events`.

### Projection path

1. `stream-processor` consumes Kafka events from the domain topics.
2. Event envelopes are validated against the shared contract.
3. Idempotency is enforced through `projection_event_applications`.
4. Projection tables are updated with upsert-based handlers.
5. Invalid or unsupported events are written to `projection_dead_letters`.

### Query path

1. Client sends a read request to `context-query-api` with auth and `x-tenant-id`.
2. The API validates the request and enforces tenant scope server-side.
3. Query services read projection tables and bounded audit references.
4. `context-query-api` emits an `audit.recorded` event describing the access.
5. `audit-writer` persists the immutable audit row.

## Replay Paths

### Outbox replay

- Failed outbox rows remain persisted with retry metadata.
- The relay retries with backoff until the row is published or requires operator inspection.

### Projection replay

- `pnpm stream:replay` clears projection tables and dedupe state.
- The processor is restarted in replay mode and reads from earliest offsets.
- Runtime offsets rely on Kafka consumer groups.
- Dedupe state remains in Postgres to prevent duplicate row application during normal processing.

## Security Model

- API calls require either `Authorization: Bearer <token>` or `x-api-key`.
- Tokens are configured by environment only in v1.
- Tenant access is enforced server-side using token tenant allowlists plus `x-tenant-id`.
- Public-facing APIs use fixed-window rate limiting.
- Logs redact common secret and authorization fields.
- APIs return stable error envelopes and avoid raw internal failures in responses.

## Observability Model

- Every request and event path carries:
  - `trace_id`
  - `tenant_id`
  - `actor_id` when present
  - `request_id`
  - `service name`
  - timestamps
- All services expose Prometheus metrics.
- OpenTelemetry spans are emitted for the main request and processing paths.
- Jaeger, Prometheus, and Grafana are included in local Compose for operator workflows.

## Reliability Notes

- Ingestion uses a transactional outbox rather than direct publish in the request path.
- Kafka publication is practically at-least-once, not globally exactly-once.
- Consumers and projections must dedupe on `event_id`.
- Projection correctness assumes ordering only within the documented partition key, not global ordering.
- Read models prefer correctness and replayability over aggressive caching.

## Known Limitations

- Local Docker Compose is not HA and is not a substitute for production orchestration.
- Kafka is single-cluster local development infrastructure, not a hardened managed deployment.
- Postgres is single-instance and has no automatic failover.
- MinIO is local object storage only and does not imply durable archival guarantees.
- Secrets are still env-based and not integrated with a secret manager.
- Docker images are suitable for build validation and local deployment rehearsal, not yet minimal hardened production images.
- Audit durability depends on Kafka and Postgres availability; dedicated DLQ re-drive tooling is still limited.
