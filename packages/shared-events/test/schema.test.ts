import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eventEnvelopeSchema,
  eventNames,
  topicByEventName,
  validateEventEnvelope,
} from '../src/index.js';

const baseEnvelope = {
  event_id: '2d3ee188-6c8d-451b-b22f-8d9218a6d7f6',
  event_version: 1,
  tenant_id: 'f3042d69-bec0-4e1d-b961-9f5e177b97a0',
  trace_id: 'trace-123',
  entity_id: 'dc5c1f4d-1dd2-4897-85fa-ca36602a0ffc',
  occurred_at: '2026-04-03T10:15:30.000Z',
  produced_at: '2026-04-03T10:15:31.000Z',
  source: 'ingest-api',
};

test('validates a customer.created envelope', () => {
  const result = validateEventEnvelope({
    ...baseEnvelope,
    event_type: eventNames.customerCreated,
    entity_type: 'customer',
    payload: {
      customer_id: baseEnvelope.entity_id,
      external_ref: 'cust-ext-001',
      email: 'customer@example.com',
      full_name: 'Ada Lovelace',
      status: 'active',
    },
  });

  assert.equal(result.event_type, eventNames.customerCreated);
  assert.equal(topicByEventName[result.event_type], 'customer-events');
});

test('rejects a non-UTC timestamp in the envelope metadata', () => {
  const result = eventEnvelopeSchema.safeParse({
    ...baseEnvelope,
    occurred_at: '2026-04-03T10:15:30+05:30',
    event_type: eventNames.orderCreated,
    entity_type: 'order',
    payload: {
      order_id: baseEnvelope.entity_id,
      customer_id: '3dba4f0f-af7a-4caf-85c8-d520d3b8c262',
      order_number: 'ORD-1001',
      status: 'pending',
      amount_cents: 1299,
      currency: 'USD',
    },
  });

  assert.equal(result.success, false);
});

test('rejects a payload that does not match the event type', () => {
  const result = eventEnvelopeSchema.safeParse({
    ...baseEnvelope,
    event_type: eventNames.agentSessionStarted,
    entity_type: 'agent_session',
    payload: {
      order_id: baseEnvelope.entity_id,
    },
  });

  assert.equal(result.success, false);
});
