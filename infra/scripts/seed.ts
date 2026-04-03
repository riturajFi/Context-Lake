import { closeDbPool, createDbPool, loadDatabaseConfig, resolveInfraPath, runSqlSeeds } from '@context-lake/shared-db';

const config = loadDatabaseConfig();
const pool = createDbPool(config.POSTGRES_URL);

try {
  await runSqlSeeds(pool, resolveInfraPath('postgres', 'seeds'));
  console.log('Seed files applied.');
} finally {
  await closeDbPool(pool);
}
