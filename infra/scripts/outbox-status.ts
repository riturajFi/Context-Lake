import { closeDbPool, createDbPool, loadDatabaseConfig } from '@context-lake/shared-db';

const config = loadDatabaseConfig();
const pool = createDbPool(config.POSTGRES_URL);

try {
  const summary = await pool.query<{
    publish_status: string;
    count: string;
  }>(`
    select publish_status, count(*)::text as count
    from outbox_events
    group by publish_status
    order by publish_status
  `);

  const backlog = await pool.query(`
    select
      event_id,
      topic,
      event_name,
      tenant_id,
      entity_type,
      entity_id,
      publish_status,
      attempt_count,
      last_error,
      available_at,
      created_at
    from outbox_events
    where publish_status in ('pending', 'processing', 'failed')
    order by created_at asc
    limit 20
  `);

  console.log('Outbox summary');
  console.table(summary.rows);
  console.log('Outbox backlog');
  console.table(backlog.rows);
} finally {
  await closeDbPool(pool);
}
