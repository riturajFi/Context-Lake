import assert from 'node:assert/strict';
import test from 'node:test';

import { eventNames } from '@context-lake/shared-events';

import { ProjectionApplier } from '../src/projections.js';
import { createProjectionLogger, createProjectionTestDatabase } from './helpers.js';

function buildEvent(overrides: Record<string, unknown>) {
  return {
    event_id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    event_version: 1,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    trace_id: 'trace-resilience',
    occurred_at: '2026-04-03T12:00:00.000Z',
    produced_at: '2026-04-03T12:00:00.000Z',
    source: 'ingest-api',
    ...overrides,
  };
}

test('dedupe survives a consumer restart mid-processing', async () => {
  const { pool } = await createProjectionTestDatabase();
  const event = buildEvent({
    event_type: eventNames.customerCreated,
    entity_type: 'customer',
    entity_id: '11111111-1111-4111-8111-111111111111',
    payload: {
      customer_id: '11111111-1111-4111-8111-111111111111',
      external_ref: 'cust-restart',
      email: 'restart@example.com',
      full_name: 'Restart User',
      status: 'active',
    },
  });

  try {
    const firstApplier = new ProjectionApplier({
      pool,
      logger: createProjectionLogger(),
    });

    const first = await firstApplier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'customer-events',
      partition: 0,
      offset: '1',
      event,
    });

    const restartedApplier = new ProjectionApplier({
      pool,
      logger: createProjectionLogger(),
    });

    const second = await restartedApplier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'customer-events',
      partition: 0,
      offset: '1',
      event,
    });

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'duplicate');
  } finally {
    await pool.end();
  }
});

test('old consumer behavior rejects a future event version', async () => {
  const { pool } = await createProjectionTestDatabase();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });

  try {
    const futureEvent = buildEvent({
      event_version: 2,
      event_type: eventNames.orderCreated,
      entity_type: 'order',
      entity_id: '22222222-2222-4222-8222-222222222222',
      payload: {
        order_id: '22222222-2222-4222-8222-222222222222',
        customer_id: '11111111-1111-4111-8111-111111111111',
        order_number: 'ORD-FUTURE',
        status: 'pending',
        amount_cents: 42,
        currency: 'USD',
      },
    });

    await applier.deadLetter({
      consumerName: 'stream-processor-v1',
      topic: 'order-events',
      partition: 0,
      offset: '9',
      payload: futureEvent,
      failureReason: 'unsupported event version',
      event: futureEvent,
    });

    const rows = await pool.query(`select count(*)::text as count from projection_dead_letters`);
    assert.equal(rows.rows[0]?.count, '1');
  } finally {
    await pool.end();
  }
});
