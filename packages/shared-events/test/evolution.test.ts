import assert from 'node:assert/strict';
import test from 'node:test';

import { eventEnvelopeSchema, eventNames, validateEventEnvelope } from '../src/index.js';

const v1OrderCreatedEnvelope = {
  event_id: '2d3ee188-6c8d-451b-b22f-8d9218a6d7f6',
  request_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  event_type: eventNames.orderCreated,
  event_version: 1,
  tenant_id: 'f3042d69-bec0-4e1d-b961-9f5e177b97a0',
  trace_id: 'trace-evolution',
  entity_type: 'order',
  entity_id: 'dc5c1f4d-1dd2-4897-85fa-ca36602a0ffc',
  occurred_at: '2026-04-03T10:15:30.000Z',
  produced_at: '2026-04-03T10:15:31.000Z',
  source: 'ingest-api',
  payload: {
    order_id: 'dc5c1f4d-1dd2-4897-85fa-ca36602a0ffc',
    customer_id: '3dba4f0f-af7a-4caf-85c8-d520d3b8c262',
    order_number: 'ORD-1001',
    status: 'pending',
    amount_cents: 1299,
    currency: 'USD',
  },
} as const;

test('new consumer remains compatible with the existing v1 event contract', () => {
  const parsed = validateEventEnvelope(v1OrderCreatedEnvelope);

  assert.equal(parsed.event_version, 1);
  assert.equal(parsed.event_type, eventNames.orderCreated);
});

test('old v1-only consumer rejects a future event version', () => {
  const result = eventEnvelopeSchema.safeParse({
    ...v1OrderCreatedEnvelope,
    event_version: 2,
  });

  assert.equal(result.success, false);
});
