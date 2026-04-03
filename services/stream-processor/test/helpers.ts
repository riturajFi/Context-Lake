import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DataType, newDb } from 'pg-mem';
import { createLogger } from '@context-lake/shared-logging';
import { resolveInfraPath, runSqlMigrations } from '@context-lake/shared-db';

import { ProjectionMetrics } from '../src/metrics.js';

export async function createProjectionTestDatabase() {
  const db = newDb();
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => crypto.randomUUID(),
    });
  });

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const sourceDirectory = resolveInfraPath('postgres', 'migrations');
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-lake-projection-migrations-'));

  await mkdir(tempDirectory, { recursive: true });

  for (const file of [
    '001_initial_schema.sql',
    '002_ingestion_resource_links.sql',
    '003_projection_views.sql',
  ]) {
    let sql = await readFile(path.join(sourceDirectory, file), 'utf8');

    if (file === '001_initial_schema.sql') {
      sql = sql
        .replace(/create or replace function[\s\S]*?\$\$ language plpgsql;/, '')
        .replace(/drop trigger if exists[\s\S]*?for each row execute function set_updated_at_timestamp\(\);/g, '');
    }

    await writeFile(path.join(tempDirectory, file), sql, 'utf8');
  }

  await runSqlMigrations(pool, tempDirectory);

  return { pool };
}

export function createProjectionLogger() {
  return createLogger('stream-processor', 'silent');
}

export function createProjectionMetrics() {
  return new ProjectionMetrics();
}
