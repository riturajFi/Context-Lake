import assert from 'node:assert/strict';
import test from 'node:test';

import { createRepositoryContext } from '@context-lake/shared-db';
import { validateEventEnvelope } from '@context-lake/shared-events';
import { eventNames } from '@context-lake/shared-events';

import { ProjectionApplier } from '../src/projections.js';
import {
  createProjectionLogger,
  createProjectionMetrics,
  createProjectionTestDatabase,
} from './helpers.js';

function buildEvent(overrides: Record<string, unknown>) {
  return {
    event_id: crypto.randomUUID(),
    event_version: 1,
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    trace_id: 'trace-1',
    occurred_at: '2026-04-03T12:00:00.000Z',
    produced_at: '2026-04-03T12:00:00.000Z',
    source: 'ingest-api',
    ...overrides,
  };
}

test('applies customer and order events in order and updates the order projection row', async () => {
  const { pool } = await createProjectionTestDatabase();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });

  try {
    await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'order-events',
      partition: 0,
      offset: '1',
      event: buildEvent({
        event_type: eventNames.orderCreated,
        entity_type: 'order',
        entity_id: '22222222-2222-4222-8222-222222222222',
        payload: {
          order_id: '22222222-2222-4222-8222-222222222222',
          customer_id: '11111111-1111-4111-8111-111111111111',
          order_number: 'ORD-1001',
          status: 'pending',
          amount_cents: 1299,
          currency: 'USD',
        },
      }),
    });

    await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'order-events',
      partition: 0,
      offset: '2',
      event: buildEvent({
        event_type: eventNames.orderStatusChanged,
        entity_type: 'order',
        entity_id: '22222222-2222-4222-8222-222222222222',
        occurred_at: '2026-04-03T12:01:00.000Z',
        payload: {
          order_id: '22222222-2222-4222-8222-222222222222',
          previous_status: 'pending',
          new_status: 'confirmed',
        },
      }),
    });

    const row = await createRepositoryContext(pool).orderContextView.findById(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222',
    );

    assert.equal(row?.status, 'confirmed');
  } finally {
    await pool.end();
  }
});

test('ignores duplicate events by event_id', async () => {
  const { pool } = await createProjectionTestDatabase();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });
  const eventId = crypto.randomUUID();

  try {
    const event = buildEvent({
      event_id: eventId,
      event_type: eventNames.customerCreated,
      entity_type: 'customer',
      entity_id: '11111111-1111-4111-8111-111111111111',
      payload: {
        customer_id: '11111111-1111-4111-8111-111111111111',
        external_ref: 'cust-1',
        email: 'customer@example.com',
        full_name: 'Ada',
        status: 'active',
      },
    });

    const first = await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'customer-events',
      partition: 0,
      offset: '1',
      event,
    });
    const second = await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'customer-events',
      partition: 0,
      offset: '2',
      event,
    });

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'duplicate');
  } finally {
    await pool.end();
  }
});

test('treats older out-of-order order status events as ignored updates', async () => {
  const { pool } = await createProjectionTestDatabase();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });

  try {
    await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'order-events',
      partition: 0,
      offset: '1',
      event: buildEvent({
        event_type: eventNames.orderCreated,
        entity_type: 'order',
        entity_id: '22222222-2222-4222-8222-222222222222',
        occurred_at: '2026-04-03T12:02:00.000Z',
        payload: {
          order_id: '22222222-2222-4222-8222-222222222222',
          customer_id: '11111111-1111-4111-8111-111111111111',
          order_number: 'ORD-1001',
          status: 'confirmed',
          amount_cents: 1299,
          currency: 'USD',
        },
      }),
    });

    const result = await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'order-events',
      partition: 0,
      offset: '2',
      event: buildEvent({
        event_type: eventNames.orderStatusChanged,
        entity_type: 'order',
        entity_id: '22222222-2222-4222-8222-222222222222',
        occurred_at: '2026-04-03T12:01:00.000Z',
        payload: {
          order_id: '22222222-2222-4222-8222-222222222222',
          previous_status: 'pending',
          new_status: 'cancelled',
        },
      }),
    });

    const row = await createRepositoryContext(pool).orderContextView.findById(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222',
    );

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'out_of_order');
    assert.equal(row?.status, 'confirmed');
  } finally {
    await pool.end();
  }
});

test('dead-letters schema version mismatches and counts a failed projection', async () => {
  const { pool } = await createProjectionTestDatabase();
  const metrics = createProjectionMetrics();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });

  try {
    const payload = {
      ...buildEvent({
        event_type: eventNames.orderCreated,
        entity_type: 'order',
        entity_id: '22222222-2222-4222-8222-222222222222',
        event_version: 2,
        payload: {
          order_id: '22222222-2222-4222-8222-222222222222',
          customer_id: '11111111-1111-4111-8111-111111111111',
          order_number: 'ORD-1001',
          status: 'pending',
          amount_cents: 1299,
          currency: 'USD',
        },
      }),
    };

    try {
      validateEventEnvelope(payload);
    } catch (error) {
      metrics.incrementFailedProjectionCount();
      await applier.deadLetter({
        consumerName: 'stream-processor-v1',
        topic: 'order-events',
        partition: 0,
        offset: '1',
        payload,
        failureReason: error instanceof Error ? error.message : 'schema version mismatch',
        event: payload,
      });
    }

    const result = await pool.query(`select * from projection_dead_letters`);
    assert.equal(result.rows.length, 1);
    assert.equal(metrics.snapshot().failed_projection_count, 1);
  } finally {
    await pool.end();
  }
});

test('resetViews clears projection tables for replay builds', async () => {
  const { pool } = await createProjectionTestDatabase();
  const applier = new ProjectionApplier({
    pool,
    logger: createProjectionLogger(),
  });

  try {
    await applier.apply({
      consumerName: 'stream-processor-v1',
      topic: 'customer-events',
      partition: 0,
      offset: '1',
      event: buildEvent({
        event_type: eventNames.customerCreated,
        entity_type: 'customer',
        entity_id: '11111111-1111-4111-8111-111111111111',
        payload: {
          customer_id: '11111111-1111-4111-8111-111111111111',
          external_ref: 'cust-1',
          email: 'customer@example.com',
          full_name: 'Ada',
          status: 'active',
        },
      }),
    });

    await applier.resetViews();

    const customers = await pool.query(`select count(*)::text as count from customer_context_view`);
    const applications = await pool.query(`select count(*)::text as count from projection_event_applications`);

    assert.equal(customers.rows[0]?.count, '0');
    assert.equal(applications.rows[0]?.count, '0');
  } finally {
    await pool.end();
  }
});
