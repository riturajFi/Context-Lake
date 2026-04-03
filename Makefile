PNPM := pnpm

.PHONY: install dev lint test typecheck build db-migrate db-seed db-migrate-smoke db-outbox db-projections stream-replay compose-up compose-down compose-logs

install:
	$(PNPM) install

dev:
	$(PNPM) dev

lint:
	$(PNPM) lint

test:
	$(PNPM) test

typecheck:
	$(PNPM) typecheck

build:
	$(PNPM) build

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

compose-down:
	$(PNPM) compose:down

compose-logs:
	$(PNPM) compose:logs
