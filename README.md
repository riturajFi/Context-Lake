# Context Lake

Production-oriented monorepo for a multi-tenant, event-driven context engine for AI agents.

The repository currently includes:

- transactional ingestion with idempotency and an outbox relay
- Kafka-backed projections into materialized context views
- a governed context query API
- append-only audit persistence
- shared auth, logging, metrics, and tracing foundations
- CI, image build, replay, resilience, and load-test basics

This is not a full production platform yet. Local Docker Compose is for development and deployment rehearsal only.

## Repository Structure

```text
services/
  ingest-api/
  context-query-api/
  stream-processor/
  audit-writer/
  presentation-web/
packages/
  shared-config/
  shared-db/
  shared-events/
  shared-http/
  shared-logging/
  shared-observability/
  shared-types/
infra/
  docker/
  load/
  postgres/
  scripts/
docs/
```

## Core Services

- `ingest-api`
  - write entrypoint for customers, orders, and agent sessions
  - transactional outbox relay
- `stream-processor`
  - Kafka consumers and projection builders
- `context-query-api`
  - low-latency read API over materialized views
- `audit-writer`
  - immutable audit log persistence from Kafka
- `presentation-web`
  - demo-ready frontend for presenting the platform
  - aggregates local service readiness into a single UI

## Local Stack

`docker compose up` starts:

- Postgres
- Zookeeper
- Kafka
- Kafka UI
- Redis
- MinIO
- Prometheus
- Grafana
- Jaeger

## Local Startup

```bash
pnpm install
bash infra/scripts/copy-env.sh
pnpm compose:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Ports

- `ingest-api`: `3001`
- `context-query-api`: `3002`
- `audit-writer` admin: `3003`
- `stream-processor` admin: `3004`
- `presentation-web`: `3010`
- `grafana`: `3005`
- `kafka-ui`: `8080`
- `prometheus`: `9090`
- `jaeger`: `16686`
- `minio`: `9000`
- `minio-console`: `9001`

## Probes And Metrics

Liveness:

- `GET http://localhost:3001/health`
- `GET http://localhost:3002/health`
- `GET http://localhost:3003/health`
- `GET http://localhost:3004/health`

Readiness:

- `GET http://localhost:3001/ready`
- `GET http://localhost:3002/ready`
- `GET http://localhost:3003/ready`
- `GET http://localhost:3004/ready`

Metrics:

- `GET http://localhost:3001/metrics`
- `GET http://localhost:3002/metrics`
- `GET http://localhost:3003/metrics`
- `GET http://localhost:3004/metrics`

Presentation UI:

- `GET http://localhost:3010`
- `GET http://localhost:3010/api/runtime`

## Developer Commands

- `pnpm lint`
- `pnpm test`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:contracts`
- `pnpm test:resilience`
- `pnpm typecheck`
- `pnpm build`
- `pnpm validate:full`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm db:migrate:smoke`
- `pnpm db:outbox`
- `pnpm db:projections`
- `pnpm stream:replay`
- `pnpm load:ingest`
- `pnpm load:context`
- `pnpm compose:up`
- `pnpm compose:up:prod`
- `pnpm compose:down`
- `pnpm compose:logs`

Make targets mirror the same commands.

## CI And Images

- [`.github/workflows/ci.yml`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/.github/workflows/ci.yml)
  - install, lint, typecheck, unit, integration, contract, resilience, build
- [`.github/workflows/docker-images.yml`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/.github/workflows/docker-images.yml)
  - builds one Docker image per service
  - runs on pull requests, `main`, and tags matching `v*.*.*`

## Production-Readiness Notes

What the repo is ready for:

- repeatable local validation
- contract and replay testing
- production-like Docker image builds
- readiness and liveness probes
- backup and restore guidance for Postgres
- deployment ordering and rollback notes

What it is not yet:

- Kubernetes-ready
- integrated with a secret manager
- backed by HA Kafka
- backed by managed Postgres failover
- backed by durable production object storage

## Key Docs

- [`docs/architecture.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/architecture.md)
- [`docs/data-model.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/data-model.md)
- [`docs/event-catalog.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/event-catalog.md)
- [`docs/ingestion.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/ingestion.md)
- [`docs/projections.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/projections.md)
- [`docs/context-query.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/context-query.md)
- [`docs/operations-runbook.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/operations-runbook.md)
- [`docs/deployment-readiness.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/deployment-readiness.md)
- [`docs/load-testing.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO PROJECTS/Context-Lake/docs/load-testing.md)

## Full Local Validation

```bash
pnpm install
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:contracts
pnpm test:resilience
pnpm typecheck
pnpm build
docker compose config
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
```
