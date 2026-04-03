import assert from 'node:assert/strict';
import test from 'node:test';

import { createContextQueryApp } from '../src/app.js';
import { createContextQueryTestDatabase, seedContextQueryFixtures } from './helpers.js';

const baseEnv = {
  SERVICE_NAME: 'context-query-api',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_URL: 'postgres://postgres:postgres@localhost:5432/context_lake',
  REDIS_URL: 'redis://localhost:6379',
  KAFKA_BROKERS: 'localhost:9092',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin',
  PORT: '3002',
  HOST: '127.0.0.1',
  SHUTDOWN_TIMEOUT_MS: '1000',
  SLOW_QUERY_THRESHOLD_MS: '1000',
  API_AUTH_TOKENS_JSON:
    '[{"token_id":"tenant-a","token":"context-lake-local-dev-token","tenant_ids":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}]',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_MAX_REQUESTS: '120',
};

test('customer context happy path', async () => {
  const { pool } = await createContextQueryTestDatabase();
  await seedContextQueryFixtures(pool);
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'GET',
    url: '/context/customer/11111111-1111-4111-8111-111111111111?audit_limit=2&related_limit=2',
    headers: {
      authorization: 'Bearer context-lake-local-dev-token',
      'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'x-request-id': 'trace-test-customer',
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.trace_id, 'trace-test-customer');
  assert.equal(body.entity_type, 'customer');
  assert.equal(body.customer.customer_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(body.related.recent_orders.length, 1);
  assert.equal(body.related.recent_agent_sessions.length, 1);
  assert.equal(body.audit_references.length, 1);
  assert.equal(body.audit_references[0].trace_id, 'trace-customer-001');

  await app.close();
  await pool.end();
});

test('returns 404 for missing entity', async () => {
  const { pool } = await createContextQueryTestDatabase();
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'GET',
    url: '/context/order/22222222-2222-4222-8222-222222222222',
    headers: {
      authorization: 'Bearer context-lake-local-dev-token',
      'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');

  await app.close();
  await pool.end();
});

test('enforces tenant isolation', async () => {
  const { pool } = await createContextQueryTestDatabase();
  await seedContextQueryFixtures(pool);
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'GET',
    url: '/context/agent-session/33333333-3333-4333-8333-333333333333',
    headers: {
      authorization: 'Bearer context-lake-local-dev-token',
      'x-tenant-id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'TENANT_FORBIDDEN');

  await app.close();
  await pool.end();
});

test('returns stable validation errors for malformed input', async () => {
  const { pool } = await createContextQueryTestDatabase();
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'GET',
    url: '/context/customer/not-a-uuid',
    headers: {
      authorization: 'Bearer context-lake-local-dev-token',
      'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'x-request-id': 'trace-invalid',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  assert.equal(response.json().error.trace_id, 'trace-invalid');

  await app.close();
  await pool.end();
});

test('returns batch context with missing list', async () => {
  const { pool } = await createContextQueryTestDatabase();
  await seedContextQueryFixtures(pool);
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'POST',
    url: '/context/batch',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer context-lake-local-dev-token',
      'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    payload: {
      items: [
        {
          entity_type: 'order',
          entity_id: '22222222-2222-4222-8222-222222222222',
        },
        {
          entity_type: 'customer',
          entity_id: '99999999-9999-4999-8999-999999999999',
        },
      ],
      audit_limit: 1,
      related_limit: 1,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].entity_type, 'order');
  assert.equal(body.missing.length, 1);

  await app.close();
  await pool.end();
});

test('denies missing auth', async () => {
  const { pool } = await createContextQueryTestDatabase();
  await seedContextQueryFixtures(pool);
  const app = await createTestApp(pool);

  const response = await app.inject({
    method: 'GET',
    url: '/context/customer/11111111-1111-4111-8111-111111111111',
    headers: {
      'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'AUTH_REQUIRED');

  await app.close();
  await pool.end();
});

async function createTestApp(pool: { query: (sql: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> }) {
  const auditPublisher = {
    async publishContextAccess() {},
    async disconnect() {},
  };

  return createContextQueryApp({
    ...baseEnv,
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    SHUTDOWN_TIMEOUT_MS: 1000,
    PORT: 3002,
    SLOW_QUERY_THRESHOLD_MS: 1000,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    SERVICE_NAME: 'context-query-api',
    NODE_ENV: 'test',
    KAFKA_BROKERS: 'localhost:9092',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
  } as never, {
    pool: pool as never,
    auditPublisher: auditPublisher as never,
  });
}
