import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DataType, newDb } from 'pg-mem';
import { createLogger } from '../../../packages/shared-logging/src/index.ts';
import {
  resolveInfraPath,
  runSqlMigrations,
} from '../../../packages/shared-db/src/index.ts';

import { IngestionMetrics } from '../src/metrics.js';

export async function createTestDatabase() {
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
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-lake-ingest-migrations-'));

  await mkdir(tempDirectory, { recursive: true });

  const firstMigration = await readFile(path.join(sourceDirectory, '001_initial_schema.sql'), 'utf8');
  const smokeFirstMigration = firstMigration
    .replace(/create or replace function[\s\S]*?\$\$ language plpgsql;/, '')
    .replace(/drop trigger if exists[\s\S]*?for each row execute function set_updated_at_timestamp\(\);/g, '');

  await writeFile(path.join(tempDirectory, '001_initial_schema.sql'), smokeFirstMigration, 'utf8');
  await writeFile(
    path.join(tempDirectory, '002_ingestion_resource_links.sql'),
    await readFile(path.join(sourceDirectory, '002_ingestion_resource_links.sql'), 'utf8'),
    'utf8',
  );
  await writeFile(
    path.join(tempDirectory, '005_audit_and_traceability.sql'),
    await readFile(path.join(sourceDirectory, '005_audit_and_traceability.sql'), 'utf8'),
    'utf8',
  );

  await runSqlMigrations(pool, tempDirectory);

  return {
    db,
    pool,
  };
}

export function createTestLogger() {
  return createLogger('ingest-api', 'silent');
}

export function createTestMetrics() {
  return new IngestionMetrics();
}

export class FakePublisher {
  published: Array<{ topic: string; key: string; eventId: string }> = [];
  shouldFail = false;

  async publish(message: { topic: string; key: string; event: { event_id: string } }) {
    if (this.shouldFail) {
      throw new Error('kafka unavailable');
    }

    this.published.push({
      topic: message.topic,
      key: message.key,
      eventId: message.event.event_id,
    });
  }

  async disconnect() {}
}
