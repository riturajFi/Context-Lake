import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqlExecutor } from './client.js';

export interface MigrationRecord {
  name: string;
  checksum: string;
  applied_at: Date | string;
}

export interface MigrationResult {
  appliedMigrations: string[];
}

export async function ensureMigrationTable(db: SqlExecutor) {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function listSqlFiles(directory: string) {
  const files = await readdir(directory);
  return files.filter((file) => file.endsWith('.sql')).sort();
}

export async function getAppliedMigrations(db: SqlExecutor) {
  const result = await db.query<MigrationRecord>(
    `select name, checksum, applied_at from schema_migrations order by name asc`,
  );

  return new Map(result.rows.map((row) => [row.name, row]));
}

export async function runSqlMigrations(db: SqlExecutor, directory: string): Promise<MigrationResult> {
  await ensureMigrationTable(db);

  const applied = await getAppliedMigrations(db);
  const files = await listSqlFiles(directory);
  const appliedMigrations: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = applied.get(file);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`checksum mismatch for migration ${file}`);
      }

      continue;
    }

    await db.query('begin');

    try {
      await db.query(sql);
      await db.query(
        `insert into schema_migrations (name, checksum) values ($1, $2)`,
        [file, checksum],
      );
      await db.query('commit');
      appliedMigrations.push(file);
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }

  return { appliedMigrations };
}

export async function runSqlSeeds(db: SqlExecutor, directory: string) {
  const files = await listSqlFiles(directory);

  for (const file of files) {
    const sql = await readFile(path.join(directory, file), 'utf8');
    await db.query(sql);
  }
}

export function resolveInfraPath(...parts: string[]) {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '../../../infra', ...parts);
}
