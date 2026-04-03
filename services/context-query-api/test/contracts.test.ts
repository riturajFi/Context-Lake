import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from '@context-lake/shared-config';

import { createContextQueryApp } from '../src/app.js';
import { createContextQueryTestDatabase, seedContextQueryFixtures } from './helpers.js';

const customerContextResponseSchema = z.object({
  trace_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  entity_type: z.literal('customer'),
  customer: z.object({
    customer_id: z.string().uuid(),
    external_ref: z.string().min(1),
    email: z.string().email(),
    full_name: z.string().min(1),
    status: z.string().min(1),
    metadata: z.record(z.unknown()),
    history: z.object({
      source_event_id: z.string().uuid(),
      source_event_version: z.number().int(),
      source_occurred_at: z.string().datetime({ offset: true }),
      projection_updated_at: z.string().datetime({ offset: true }),
    }),
  }),
  related: z.object({
    recent_orders: z.array(z.object({
      order_id: z.string().uuid(),
      customer_id: z.string().uuid(),
      order_number: z.string().min(1),
      status: z.string().min(1),
      amount_cents: z.number().int(),
      currency: z.string().length(3),
      metadata: z.record(z.unknown()),
      history: z.object({
        source_event_id: z.string().uuid(),
        source_event_version: z.number().int(),
        source_occurred_at: z.string().datetime({ offset: true }),
        projection_updated_at: z.string().datetime({ offset: true }),
      }),
    })),
    recent_agent_sessions: z.array(z.object({
      session_id: z.string().uuid(),
      customer_id: z.string().uuid().nullable(),
      order_id: z.string().uuid().nullable(),
      status: z.string().nullable(),
      channel: z.string().nullable(),
      history: z.object({
        source_event_id: z.string().uuid(),
        source_event_version: z.number().int(),
        source_occurred_at: z.string().datetime({ offset: true }),
        projection_updated_at: z.string().datetime({ offset: true }),
      }),
    }).passthrough()),
  }),
  audit_references: z.array(z.object({
    audit_id: z.string().uuid(),
    event_type: z.string().min(1),
    actor_id: z.string().uuid().nullable(),
    trace_id: z.string().min(1),
    occurred_at: z.string().datetime({ offset: true }),
    created_at: z.string().datetime({ offset: true }),
    agent_session_id: z.string().uuid().nullable(),
    entity_type: z.string().min(1),
    entity_id: z.string().uuid(),
    payload_summary: z.object({
      message: z.string().nullable(),
      severity: z.string().nullable(),
    }),
  })),
});

test('customer context response matches the public contract', async () => {
  const { pool } = await createContextQueryTestDatabase();
  await seedContextQueryFixtures(pool);
  const app = await createContextQueryApp(
    {
      SERVICE_NAME: 'context-query-api',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      POSTGRES_URL: 'postgres://postgres:postgres@localhost:5432/context_lake',
      REDIS_URL: 'redis://localhost:6379',
      KAFKA_BROKERS: 'localhost:9092',
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: 9000,
      MINIO_USE_SSL: false,
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin',
      PORT: 3002,
      HOST: '127.0.0.1',
      SHUTDOWN_TIMEOUT_MS: 1000,
      SLOW_QUERY_THRESHOLD_MS: 1000,
      API_AUTH_TOKENS_JSON:
        '[{"token_id":"tenant-a","token":"context-lake-local-dev-token","tenant_ids":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}]',
      RATE_LIMIT_WINDOW_MS: 60000,
      RATE_LIMIT_MAX_REQUESTS: 120,
    } as never,
    {
      pool: pool as never,
      auditPublisher: {
        async publishContextAccess() {},
        async disconnect() {},
      } as never,
    },
  );

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/context/customer/11111111-1111-4111-8111-111111111111',
      headers: {
        authorization: 'Bearer context-lake-local-dev-token',
        'x-tenant-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    assert.equal(response.statusCode, 200);
    const parsed = customerContextResponseSchema.safeParse(response.json());
    assert.equal(parsed.success, true);
  } finally {
    await app.close();
    await pool.end();
  }
});
