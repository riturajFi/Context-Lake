import { closeDbPool, createDbPool, loadDatabaseConfig } from '@context-lake/shared-db';

const config = loadDatabaseConfig();
const pool = createDbPool(config.POSTGRES_URL);

try {
  const tables = [
    'customer_context_view',
    'order_context_view',
    'agent_session_context_view',
    'projection_event_applications',
    'projection_dead_letters',
  ];

  for (const table of tables) {
    const count = await pool.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    console.log(`${table}: ${count.rows[0]?.count ?? '0'}`);
  }

  console.log('Recent order projections');
  console.table(
    (
      await pool.query(`
        select tenant_id, order_id, status, source_event_id, source_occurred_at, projection_updated_at
        from order_context_view
        order by projection_updated_at desc
        limit 20
      `)
    ).rows,
  );
} finally {
  await closeDbPool(pool);
}
