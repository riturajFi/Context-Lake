import assert from 'node:assert/strict';
import test from 'node:test';

import { createRepositoryContext } from '../../../packages/shared-db/src/index.ts';

import { OutboxRelay } from '../src/relay.js';
import { IngestService } from '../src/service.js';
import { createTestDatabase, createTestLogger, createTestMetrics, FakePublisher } from './helpers.js';

test('ingests a customer and writes domain, ingestion, idempotency, and outbox records', async () => {
  const { pool } = await createTestDatabase();
  const service = new IngestService({
    pool,
    logger: createTestLogger(),
    metrics: createTestMetrics(),
  });

  try {
    const result = await service.ingestCustomer(
      {
        external_ref: 'cust-001',
        email: 'customer@example.com',
        full_name: 'Grace Hopper',
        status: 'active',
        metadata: { source: 'test' },
      },
      {
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        traceId: 'trace-1',
        idempotencyKey: 'customer-1',
        source: 'ingest-api',
      },
    );

    assert.equal(result.duplicate, false);

    const repositories = createRepositoryContext(pool);
    const customer = await repositories.customers.findById(result.tenant_id, result.resource_id);
    const outbox = await repositories.outbox.findById(result.event_id);
    const idempotency = await repositories.idempotencyKeys.findByKey(
      result.tenant_id,
      'ingest.customer',
      'customer-1',
    );
    const ingestionRequest = await repositories.ingestionRequests.findById(
      result.tenant_id,
      result.request_id,
    );

    assert.ok(customer);
    assert.ok(outbox);
    assert.ok(idempotency);
    assert.ok(ingestionRequest);
    assert.equal(outbox?.publish_status, 'pending');
    assert.equal(idempotency?.resource_id, result.resource_id);
    assert.equal(ingestionRequest?.resource_id, result.resource_id);
  } finally {
    await pool.end();
  }
});

test('returns the original resource for a duplicate request with the same idempotency key', async () => {
  const { pool } = await createTestDatabase();
  const service = new IngestService({
    pool,
    logger: createTestLogger(),
    metrics: createTestMetrics(),
  });

  try {
    const first = await service.ingestCustomer(
      {
        external_ref: 'cust-duplicate',
        email: 'dup@example.com',
        full_name: 'Dup User',
        status: 'active',
        metadata: {},
      },
      {
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        traceId: 'trace-dup',
        idempotencyKey: 'customer-dup',
        source: 'ingest-api',
      },
    );

    const second = await service.ingestCustomer(
      {
        external_ref: 'cust-duplicate',
        email: 'dup@example.com',
        full_name: 'Dup User',
        status: 'active',
        metadata: {},
      },
      {
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        traceId: 'trace-dup-2',
        idempotencyKey: 'customer-dup',
        source: 'ingest-api',
      },
    );

    assert.equal(second.duplicate, true);
    assert.equal(second.resource_id, first.resource_id);
    assert.equal(second.event_id, first.event_id);

    const count = await pool.query(`select count(*)::text as count from customers`);
    assert.equal(count.rows[0]?.count, '1');
  } finally {
    await pool.end();
  }
});

test('rolls back the transaction on database failure', async () => {
  const { pool } = await createTestDatabase();
  const service = new IngestService({
    pool,
    logger: createTestLogger(),
    metrics: createTestMetrics(),
  });

  try {
    await pool.query('drop table customers cascade');

    await assert.rejects(
      service.ingestCustomer(
        {
          external_ref: 'cust-fail',
          email: 'fail@example.com',
          full_name: 'Failure Case',
          status: 'active',
          metadata: {},
        },
        {
          tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          traceId: 'trace-fail',
          idempotencyKey: 'customer-fail',
          source: 'ingest-api',
        },
      ),
    );

    const ingestionCount = await pool.query(`select count(*)::text as count from ingestion_requests`);
    const outboxCount = await pool.query(`select count(*)::text as count from outbox_events`);
    const idempotencyCount = await pool.query(`select count(*)::text as count from idempotency_keys`);

    assert.equal(ingestionCount.rows[0]?.count, '0');
    assert.equal(outboxCount.rows[0]?.count, '0');
    assert.equal(idempotencyCount.rows[0]?.count, '0');
  } finally {
    await pool.end();
  }
});

test('marks outbox rows failed when kafka publishing is unavailable and retries later', async () => {
  const { pool } = await createTestDatabase();
  const metrics = createTestMetrics();
  const publisher = new FakePublisher();
  const service = new IngestService({
    pool,
    logger: createTestLogger(),
    metrics,
  });

  try {
    const result = await service.ingestCustomer(
      {
        external_ref: 'cust-relay',
        email: 'relay@example.com',
        full_name: 'Relay User',
        status: 'active',
        metadata: {},
      },
      {
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        traceId: 'trace-relay',
        idempotencyKey: 'customer-relay',
        source: 'ingest-api',
      },
    );

    const relay = new OutboxRelay({
      pool,
      publisher,
      logger: createTestLogger(),
      metrics,
      pollIntervalMs: 1000,
      batchSize: 10,
      maxRetryDelaySeconds: 5,
    });

    publisher.shouldFail = true;
    await relay.tick();

    const failed = await createRepositoryContext(pool).outbox.findById(result.event_id);
    assert.equal(failed?.publish_status, 'failed');
    assert.equal(metrics.snapshot().outbox_publish_failure_total, 1);

    publisher.shouldFail = false;
    await pool.query(`update outbox_events set available_at = now() where event_id = $1`, [result.event_id]);
    await relay.tick();

    const published = await createRepositoryContext(pool).outbox.findById(result.event_id);
    assert.equal(published?.publish_status, 'published');
    assert.equal(publisher.published.length, 1);
    assert.equal(metrics.snapshot().outbox_publish_success_total, 1);
  } finally {
    await pool.end();
  }
});
