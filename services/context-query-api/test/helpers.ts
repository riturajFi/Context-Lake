import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DataType, newDb } from 'pg-mem';
import { resolveInfraPath, runSqlMigrations } from '../../../packages/shared-db/src/index.ts';

export async function createContextQueryTestDatabase() {
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
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-lake-context-query-'));

  await mkdir(tempDirectory, { recursive: true });

  for (const file of [
    '001_initial_schema.sql',
    '002_ingestion_resource_links.sql',
    '003_projection_views.sql',
    '004_context_query_indexes.sql',
    '005_audit_and_traceability.sql',
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

export async function seedContextQueryFixtures(pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) {
  await pool.query(`
    insert into customers (
      id,
      tenant_id,
      external_ref,
      email,
      full_name,
      status,
      metadata
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cust-ext-001',
      'ada@example.com',
      'Ada Lovelace',
      'active',
      '{"segment":"enterprise"}'::jsonb
    )
  `);

  await pool.query(`
    insert into orders (
      id,
      tenant_id,
      customer_id,
      order_number,
      status,
      amount_cents,
      currency,
      metadata
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'ORD-1001',
      'confirmed',
      1299,
      'USD',
      '{"channel":"checkout"}'::jsonb
    )
  `);

  await pool.query(`
    insert into agent_sessions (
      id,
      tenant_id,
      customer_id,
      order_id,
      status,
      trace_id,
      channel,
      context_summary,
      started_at
    ) values (
      '33333333-3333-4333-8333-333333333333',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'active',
      'trace-session-001',
      'api',
      '{"phase":"assist"}'::jsonb,
      '2026-04-03T10:03:00.000Z'
    )
  `);

  await pool.query(`
    insert into customer_context_view (
      tenant_id,
      customer_id,
      external_ref,
      email,
      full_name,
      status,
      customer_metadata,
      source_event_id,
      source_event_version,
      source_occurred_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'cust-ext-001',
      'ada@example.com',
      'Ada Lovelace',
      'active',
      '{"segment":"enterprise"}'::jsonb,
      '90000000-0000-4000-8000-000000000001',
      1,
      '2026-04-03T10:00:00.000Z'
    )
  `);

  await pool.query(`
    insert into order_context_view (
      tenant_id,
      order_id,
      customer_id,
      order_number,
      status,
      amount_cents,
      currency,
      order_metadata,
      source_event_id,
      source_event_version,
      source_occurred_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      'ORD-1001',
      'confirmed',
      1299,
      'USD',
      '{"channel":"checkout"}'::jsonb,
      '90000000-0000-4000-8000-000000000002',
      1,
      '2026-04-03T10:02:00.000Z'
    )
  `);

  await pool.query(`
    insert into agent_session_context_view (
      tenant_id,
      agent_session_id,
      customer_id,
      order_id,
      status,
      channel,
      last_context_request_id,
      last_context_query_text,
      last_context_scope,
      last_response_id,
      last_response_model,
      last_response_token_count,
      session_summary,
      source_event_id,
      source_event_version,
      source_occurred_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'active',
      'api',
      '44444444-4444-4444-8444-444444444444',
      'summarize order status',
      '["customer","order"]'::jsonb,
      '55555555-5555-4555-8555-555555555555',
      'gpt-5.4',
      431,
      '{"phase":"assist"}'::jsonb,
      '90000000-0000-4000-8000-000000000003',
      1,
      '2026-04-03T10:03:00.000Z'
    )
  `);

  await pool.query(`
    insert into agent_audit_logs (
      id,
      tenant_id,
      agent_session_id,
      event_type,
      actor_id,
      entity_type,
      entity_id,
      trace_id,
      payload,
      occurred_at
    ) values
    (
      '66666666-6666-4666-8666-666666666666',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'audit.recorded',
      null,
      'customer',
      '11111111-1111-4111-8111-111111111111',
      'trace-customer-001',
      '{"message":"customer ingested","severity":"info"}'::jsonb,
      '2026-04-03T10:04:00.000Z'
    ),
    (
      '77777777-7777-4777-8777-777777777777',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'audit.recorded',
      null,
      'order',
      '22222222-2222-4222-8222-222222222222',
      'trace-order-001',
      '{"message":"order confirmed","severity":"info"}'::jsonb,
      '2026-04-03T10:05:00.000Z'
    ),
    (
      '88888888-8888-4888-8888-888888888888',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'audit.recorded',
      null,
      'agent_session',
      '33333333-3333-4333-8333-333333333333',
      'trace-session-001',
      '{"message":"session active","severity":"info"}'::jsonb,
      '2026-04-03T10:06:00.000Z'
    )
  `);
}
