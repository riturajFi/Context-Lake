PNPM := pnpm

.PHONY: install dev lint test test-unit test-integration test-contracts test-resilience typecheck build validate-full load-ingest load-context db-migrate db-seed db-migrate-smoke db-outbox db-projections stream-replay compose-up compose-up-prod compose-down compose-logs

install:
	$(PNPM) install

dev:
	$(PNPM) dev

lint:
	$(PNPM) lint

test:
	$(PNPM) test

test-unit:
	$(PNPM) test:unit

test-integration:
	$(PNPM) test:integration

test-contracts:
	$(PNPM) test:contracts

test-resilience:
	$(PNPM) test:resilience

typecheck:
	$(PNPM) typecheck

build:
	$(PNPM) build

validate-full:
	$(PNPM) validate:full

load-ingest:
	$(PNPM) load:ingest

load-context:
	$(PNPM) load:context

db-migrate:
	$(PNPM) db:migrate

db-seed:
	$(PNPM) db:seed

db-migrate-smoke:
	$(PNPM) db:migrate:smoke

db-outbox:
	$(PNPM) db:outbox

db-projections:
	$(PNPM) db:projections

stream-replay:
	$(PNPM) stream:replay

compose-up:
	$(PNPM) compose:up

compose-up-prod:
	$(PNPM) compose:up:prod

compose-down:
	$(PNPM) compose:down

compose-logs:
	$(PNPM) compose:logs
