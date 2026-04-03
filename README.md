# Context Lake

Production-oriented monorepo skeleton for a real-time context engine for AI agents. This milestone sets up local developer experience, shared runtime foundations, and Dockerized infrastructure only.

## Repository Structure

```text
services/
  ingest-api/
  context-query-api/
  stream-processor/
  audit-writer/
packages/
  shared-config/
  shared-types/
  shared-logging/
  shared-http/
  shared-events/
infra/
  docker/
  scripts/
docs/
```

## Stack

- Node.js + TypeScript
- pnpm workspaces
- Fastify for HTTP services
- Pino for structured JSON logging
- Zod + dotenv for environment validation
- Docker Compose for local infrastructure

## Local Infrastructure

`docker compose up` starts:

- Postgres
- Zookeeper
- Kafka
- Kafka UI
- Redis
- MinIO

## Environment Setup

1. Install Node.js 20+ and pnpm 10+.
2. Install dependencies:

```bash
pnpm install
```

3. Copy service environment files:

```bash
bash infra/scripts/copy-env.sh
```

4. Start infrastructure:

```bash
docker compose up -d
```

5. Start all apps in watch mode:

```bash
pnpm dev
```

## Service Ports

- `ingest-api`: `3001`
- `context-query-api`: `3002`
- `kafka-ui`: `8080`
- `minio`: `9000`
- `minio-console`: `9001`

## Health Endpoints

- `GET http://localhost:3001/health`
- `GET http://localhost:3002/health`

Each API health endpoint performs dependency reachability checks for the services it needs at this stage.

## Developer Commands

- `pnpm install`
- `pnpm dev`
- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm db:migrate:smoke`
- `pnpm db:outbox`
- `pnpm db:projections`
- `pnpm stream:replay`
- `pnpm compose:up`
- `pnpm compose:down`
- `pnpm compose:logs`

Make equivalents are also available:

- `make install`
- `make dev`
- `make lint`
- `make test`
- `make typecheck`
- `make build`
- `make db-migrate`
- `make db-seed`
- `make db-migrate-smoke`
- `make db-outbox`
- `make db-projections`
- `make stream-replay`
- `make compose-up`
- `make compose-down`
- `make compose-logs`

## Milestone 2: Contracts And Persistence

This repository now includes:

- Versioned v1 event envelopes and schemas in [`packages/shared-events/src/index.ts`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/packages/shared-events/src/index.ts)
- Postgres schema migration in [`infra/postgres/migrations/001_initial_schema.sql`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/infra/postgres/migrations/001_initial_schema.sql)
- Local development seed data in [`infra/postgres/seeds/001_dev_seed.sql`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/infra/postgres/seeds/001_dev_seed.sql)
- Migration and seed runners in [`infra/scripts/migrate.ts`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/infra/scripts/migrate.ts) and [`infra/scripts/seed.ts`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/infra/scripts/seed.ts)
- Typed query helpers and repository foundations in [`packages/shared-db/src/repositories.ts`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/packages/shared-db/src/repositories.ts)

### Migration Commands

Assuming `.env` contains `POSTGRES_URL`:

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:migrate:smoke
```

### Topic List

- `customer-events`
- `order-events`
- `agent-events`
- `audit-events`

### Schema List

- `customers`
- `orders`
- `agent_sessions`
- `agent_audit_logs`
- `ingestion_requests`
- `idempotency_keys`
- `outbox_events`
- `schema_migrations`

### Migration List

- `001_initial_schema.sql`

### Additional Docs

- [`docs/data-model.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/data-model.md)
- [`docs/event-catalog.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/event-catalog.md)
- [`docs/ingestion.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/ingestion.md)
- [`docs/projections.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/projections.md)
- [`docs/context-query.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/context-query.md)

## Milestone 4: Stream Processing

Implemented in this repo:

- Kafka consumers for `customer-events`, `order-events`, and `agent-events`
- Projection handlers for v1 event types
- Materialized context tables:
  - `customer_context_view`
  - `order_context_view`
  - `agent_session_context_view`
- Dedupe ledger:
  - `projection_event_applications`
- Poison event storage:
  - `projection_dead_letters`
- Replay reset support from earliest offsets

### Replay Projections Locally

```bash
pnpm stream:replay
```

### Inspect Projection Tables

```bash
pnpm db:projections
```

## Milestone 3: Ingestion Path

Implemented in this repo:

- `POST /ingest/customer`
- `POST /ingest/order`
- `POST /ingest/agent-session`
- `GET /health`
- Transactional writes of domain row + outbox row + ingestion record + idempotency ledger
- Background outbox relay inside `ingest-api`
- Kafka publish abstraction in [`packages/shared-events/src/index.ts`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/packages/shared-events/src/index.ts)
- Integration tests for happy path, duplicate requests, DB failure rollback, Kafka unavailable, and retry behavior

### Inspecting Outbox Backlog

```bash
pnpm db:outbox
```

### Run Order For Local Testing

```bash
pnpm install
bash infra/scripts/copy-env.sh
pnpm compose:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Milestone 5: Context Serving API

Implemented in this repo:

- `GET /context/customer/:customerId`
- `GET /context/order/:orderId`
- `GET /context/agent-session/:sessionId`
- `POST /context/batch`
- `GET /health`
- Tenant-aware server-side request handling via `x-tenant-id`
- Bounded embedded related lists and audit references
- Request timing metrics and slow request logging
- Shared internal HTTP helper for context-query callers

### Example Local Reads

```bash
curl -H 'x-tenant-id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' \
  http://localhost:3002/context/customer/11111111-1111-4111-8111-111111111111

curl -X POST http://localhost:3002/context/batch \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' \
  -d '{
    "items": [
      { "entity_type": "customer", "entity_id": "11111111-1111-4111-8111-111111111111" },
      { "entity_type": "order", "entity_id": "22222222-2222-4222-8222-222222222222" }
    ],
    "audit_limit": 3,
    "related_limit": 3
  }'
```

## Current Scope

Included in this milestone:

- Bootable API and worker services
- Shared config, logging, HTTP bootstrap, types, and event constants
- Request ID propagation for HTTP APIs
- Graceful shutdown handling
- Dependency-aware API health checks
- Docker Compose infrastructure with health checks and named volumes

Explicitly not included yet:

- Domain logic
- Authentication
- Database schema or migrations
- Kafka producers or consumers beyond connectivity checks
