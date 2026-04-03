# Context Lake 🌊

Context Lake is a **real-time context engine for AI agents**.

It helps you:

- ingest operational data safely
- publish events through Kafka
- build fast read models
- serve agent-friendly context over APIs
- keep an audit trail of what happened

Think of it like this:

**write data -> publish events -> build projections -> serve context -> store audit history**

This repo is built for local development and project demos. It is **production-oriented**, but the included Docker Compose setup is **not full production infrastructure**.

## ✨ What You Can Show With This Project

- a transactional ingestion pipeline
- Kafka-based event flow
- materialized context views for fast reads
- an audit trail for access and agent activity
- metrics, tracing, and health/readiness checks
- a presentation frontend for demoing the system

## 🧱 Main Services

- `ingest-api`
  - receives write requests
  - stores source-of-truth data and outbox events
- `stream-processor`
  - consumes Kafka events
  - builds projection tables
- `context-query-api`
  - serves context from projections
- `audit-writer`
  - stores immutable audit rows
- `presentation-web`
  - frontend for presenting the architecture and live runtime

## 🗂️ Repo Structure

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

## ✅ Prerequisites

Install these first:

- Node.js `20+`
- `pnpm`
- Docker Desktop or Docker Engine with Compose

Check versions:

```bash
node -v
pnpm -v
docker --version
docker compose version
```

## 🚀 Quick Start

Run these commands from the repo root:

```bash
pnpm install
bash infra/scripts/copy-env.sh
pnpm compose:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

What each step does:

1. `pnpm install`
   installs all workspace dependencies
2. `bash infra/scripts/copy-env.sh`
   creates local `.env` files from the examples
3. `pnpm compose:up`
   starts Postgres, Kafka, Redis, MinIO, Grafana, Prometheus, and Jaeger
4. `pnpm db:migrate`
   creates the database schema
5. `pnpm db:seed`
   loads local sample data
6. `pnpm dev`
   starts all app services in watch mode

## 🌐 What To Open After Startup

### Main app

- Presentation UI: `http://localhost:3010`

This is the best place to start if you want to **present the project**.

### APIs

- Ingest API: `http://localhost:3001`
- Context Query API: `http://localhost:3002`
- Audit Writer admin: `http://localhost:3003`
- Stream Processor admin: `http://localhost:3004`

### Infra and observability

- Grafana: `http://localhost:3005`
- Kafka UI: `http://localhost:8080`
- Prometheus: `http://localhost:9090`
- Jaeger: `http://localhost:16686`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

## 🩺 Health, Readiness, and Metrics

### Health

- `http://localhost:3001/health`
- `http://localhost:3002/health`
- `http://localhost:3003/health`
- `http://localhost:3004/health`

### Readiness

- `http://localhost:3001/ready`
- `http://localhost:3002/ready`
- `http://localhost:3003/ready`
- `http://localhost:3004/ready`

### Metrics

- `http://localhost:3001/metrics`
- `http://localhost:3002/metrics`
- `http://localhost:3003/metrics`
- `http://localhost:3004/metrics`

### Presentation runtime API

- `http://localhost:3010/api/runtime`

## 🧪 How To Use The Project Locally

Once everything is running, use it in this order:

### 1. Open the presentation frontend

Go to:

```text
http://localhost:3010
```

You’ll see:

- system overview
- service health/readiness
- architecture flow
- request lifecycle

### 2. Check that services are ready

```bash
curl http://localhost:3001/ready
curl http://localhost:3002/ready
curl http://localhost:3003/ready
curl http://localhost:3004/ready
```

### 3. Ingest a customer

```bash
curl -X POST http://localhost:3001/ingest/customer \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer context-lake-local-dev-token' \
  -H 'x-tenant-id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' \
  -H 'idempotency-key: customer-demo-001' \
  -d '{
    "external_ref": "cust-demo-001",
    "email": "demo@example.com",
    "full_name": "Demo User",
    "status": "active",
    "metadata": {
      "source": "demo"
    }
  }'
```

### 4. Query customer context

```bash
curl http://localhost:3002/context/customer/11111111-1111-4111-8111-111111111111 \
  -H 'authorization: Bearer context-lake-local-dev-token' \
  -H 'x-tenant-id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
```

### 5. Inspect the outbox backlog

```bash
pnpm db:outbox
```

### 6. Inspect projections

```bash
pnpm db:projections
```

### 7. Replay projections if needed

```bash
pnpm stream:replay
```

## 🛠️ Useful Commands

### Development

```bash
pnpm dev
pnpm compose:up
pnpm compose:down
pnpm compose:logs
```

### Database

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:migrate:smoke
pnpm db:outbox
pnpm db:projections
```

### Validation

```bash
pnpm lint
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:contracts
pnpm test:resilience
pnpm typecheck
pnpm build
pnpm validate:full
```

### Load testing

```bash
pnpm load:ingest
pnpm load:context
```

## 🧠 How The System Works

### Write path

1. external system calls `ingest-api`
2. request is validated
3. DB transaction writes:
   - domain row
   - idempotency record
   - ingestion record
   - outbox event
4. outbox relay publishes to Kafka

### Processing path

1. `stream-processor` consumes Kafka events
2. validates event envelope
3. updates projection tables
4. ignores duplicates safely

### Read path

1. caller hits `context-query-api`
2. API reads projection tables
3. returns context-shaped response
4. emits an audit event

### Audit path

1. `audit-writer` consumes audit events
2. stores immutable audit rows

## 🔐 Local Demo Auth

Use this token locally:

```text
context-lake-local-dev-token
```

Example auth header:

```bash
-H 'authorization: Bearer context-lake-local-dev-token'
```

## 📚 Helpful Docs

- [`docs/architecture.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/architecture.md)
- [`docs/data-model.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/data-model.md)
- [`docs/event-catalog.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/event-catalog.md)
- [`docs/ingestion.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/ingestion.md)
- [`docs/projections.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/projections.md)
- [`docs/context-query.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/context-query.md)
- [`docs/operations-runbook.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/operations-runbook.md)
- [`docs/deployment-readiness.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/deployment-readiness.md)
- [`docs/load-testing.md`](/home/riturajtripathy/Documents/_Code/personal_projects/PORTFOLIO%20PROJECTS/Context-Lake/docs/load-testing.md)

## 🧾 Full Local Validation

If you want to verify the full repo:

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

## ⚠️ Notes

- This repo is **great for demos, development, and architecture reviews**
- Docker Compose here is **not a full production deployment**
- HA Kafka, secret managers, managed Postgres failover, and durable object storage are still future work
