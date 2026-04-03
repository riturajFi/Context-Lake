import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface SqlExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export type DbTransaction = PoolClient;

export function createDbPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 10,
  });
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDbPool(pool: Pool) {
  await pool.end();
}
