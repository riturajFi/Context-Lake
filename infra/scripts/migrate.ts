import { closeDbPool, createDbPool, loadDatabaseConfig, resolveInfraPath, runSqlMigrations } from '@context-lake/shared-db';

const config = loadDatabaseConfig();
const pool = createDbPool(config.POSTGRES_URL);

try {
  const result = await runSqlMigrations(pool, resolveInfraPath('postgres', 'migrations'));
  console.log(
    result.appliedMigrations.length > 0
      ? `Applied migrations: ${result.appliedMigrations.join(', ')}`
      : 'No pending migrations.',
  );
} finally {
  await closeDbPool(pool);
}
