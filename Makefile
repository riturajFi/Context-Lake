PNPM := pnpm

.PHONY: install dev lint test typecheck build compose-up compose-down compose-logs

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

compose-up:
	$(PNPM) compose:up

compose-down:
	$(PNPM) compose:down

compose-logs:
	$(PNPM) compose:logs
