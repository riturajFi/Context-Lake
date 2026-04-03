# Deployment Readiness

## Scope

This repository now has enough CI, image build, validation, and operational guidance to rehearse production-like deployment. It is still intentionally explicit about what remains outside v1.

## CI And Image Build

GitHub Actions workflows:

- `.github/workflows/ci.yml`
  - install
  - lint
  - typecheck
  - unit tests
  - integration tests
  - contract tests
  - resilience tests
  - build
- `.github/workflows/docker-images.yml`
  - builds one image per service on pull requests and `main`
  - also runs on tags matching `v*.*.*`

## Version Tagging Strategy

Use semantic version tags for release candidates and deployable cuts:

- `v0.1.0`
- `v0.1.1`
- `v0.2.0`

Guidance:

1. Merge changes into `main` only after CI is green.
2. Apply database migrations before scaling traffic to code that depends on them.
3. Cut a signed or otherwise protected Git tag in the `v<major>.<minor>.<patch>` format.
4. Let the image build workflow produce a traceable image per service using the Git SHA.
5. Record the release tag, migration set, and rollback target together.

The current repo does not yet push images to a registry. That remains an environment-specific deployment step.

## Deployment Order

Recommended order for production-like rollout:

1. Provision dependencies:
   - Postgres
   - Kafka
   - Redis
   - object storage
   - metrics and trace sinks
2. Apply additive DB migrations.
3. Deploy background consumers that can tolerate both old and new producers.
4. Deploy `ingest-api`.
5. Deploy `context-query-api`.
6. Verify:
   - `/ready`
   - Kafka lag
   - outbox backlog
   - projection dead letters
   - audit ingestion

## Rollback Approach

Application rollback:

1. Roll back service images to the previous tag.
2. Keep additive migrations in place if they are backward compatible.
3. Drain or pause consumers only if the newer code produced incompatible behavior.

Database rollback:

- Prefer forward-fix migrations.
- Avoid destructive down migrations during live traffic.
- If a rollback requires schema removal, do it in a separate maintenance window after old code is restored.

## Migration Strategy

Rules for safe schema evolution:

- Make schema changes additive first.
- Deploy consumers that can ignore unknown event versions before producers emit them.
- Do not remove columns or constraints in the same release where new code starts relying on replacements.
- Backfill data separately from request-serving changes.
- Keep replay paths working against the latest schema before promoting the release.

## Zero-Downtime Considerations

- `/health` is liveness only.
- `/ready` performs dependency-aware readiness checks.
- New services should be added behind readiness-aware load balancing.
- Consumers should support restart and duplicate delivery without corrupting state.
- Use partition-key-stable event contracts to avoid reordering surprises during rolling deploys.

## Backup And Restore

### Postgres backup

Example logical backup:

```bash
pg_dump "$POSTGRES_URL" --format=custom --file context-lake.dump
```

### Postgres restore

Restore into an empty target database:

```bash
pg_restore --clean --if-exists --no-owner --dbname "$POSTGRES_URL" context-lake.dump
```

### Kafka and object storage

- Kafka topic retention and broker durability are external platform concerns in production.
- MinIO in local Compose is for development only and is not a production durability guarantee.

## Production Safety Defaults To Review

- Replace local dev tokens with managed secrets.
- Run behind TLS termination.
- Use managed Postgres with automated backups and failover.
- Use HA Kafka or a managed streaming platform.
- Replace local MinIO with durable object storage.
- Push signed images to a registry with provenance metadata.
