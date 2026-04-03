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

1. Install Node.js 22+ and pnpm 10+.
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
- `make compose-up`
- `make compose-down`
- `make compose-logs`

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
