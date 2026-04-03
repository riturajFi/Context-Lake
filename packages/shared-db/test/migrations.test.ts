import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DataType, newDb } from 'pg-mem';

import { resolveInfraPath, runSqlMigrations } from '../src/migrations.js';

test('runs the initial SQL migrations successfully', async () => {
  const db = newDb();
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => '00000000-0000-4000-8000-000000000001',
    });
  });

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const sourceDirectory = resolveInfraPath('postgres', 'migrations');
  const sourceSql = await readFile(path.join(sourceDirectory, '001_initial_schema.sql'), 'utf8');
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-lake-migrations-'));
  const smokeSql = sourceSql
    .replace(/create or replace function[\s\S]*?\$\$ language plpgsql;/, '')
    .replace(/drop trigger if exists[\s\S]*?for each row execute function set_updated_at_timestamp\(\);/g, '');

  await writeFile(path.join(tempDirectory, '001_initial_schema.sql'), smokeSql, 'utf8');

  try {
    const result = await runSqlMigrations(pool, tempDirectory);
    assert.deepEqual(result.appliedMigrations, ['001_initial_schema.sql']);

    const tableResult = await pool.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'customers',
          'orders',
          'agent_sessions',
          'agent_audit_logs',
          'ingestion_requests',
          'idempotency_keys',
          'outbox_events',
          'schema_migrations'
        )
      order by table_name
    `);

    assert.equal(tableResult.rows.length, 8);
  } finally {
    await pool.end();
  }
});
