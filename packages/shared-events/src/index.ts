import { z } from 'zod';
import { Kafka, type Producer } from 'kafkajs';

import type { EntityType, TopicName } from '@context-lake/shared-types';

const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith('Z'), 'timestamp must be UTC');

const eventVersionSchema = z.literal(1);

export const topicNames = {
  customer: 'customer-events',
  order: 'order-events',
  agent: 'agent-events',
  audit: 'audit-events',
} as const satisfies Record<string, TopicName>;

export const eventNames = {
  customerCreated: 'customer.created',
  customerUpdated: 'customer.updated',
  orderCreated: 'order.created',
  orderStatusChanged: 'order.status_changed',
  agentSessionStarted: 'agent.session.started',
  agentContextRequested: 'agent.context.requested',
  agentResponseGenerated: 'agent.response.generated',
  auditRecorded: 'audit.recorded',
} as const;

const entityTypes = [
  'customer',
  'order',
  'agent_session',
  'agent_audit_event',
  'ingestion_request',
  'outbox_event',
  'idempotency_key',
] as const satisfies readonly EntityType[];

export type EventName = (typeof eventNames)[keyof typeof eventNames];
export type EventVersion = z.infer<typeof eventVersionSchema>;

export const baseEventMetadataSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum([
    eventNames.customerCreated,
    eventNames.customerUpdated,
    eventNames.orderCreated,
    eventNames.orderStatusChanged,
    eventNames.agentSessionStarted,
    eventNames.agentContextRequested,
    eventNames.agentResponseGenerated,
    eventNames.auditRecorded,
  ]),
  event_version: eventVersionSchema,
  tenant_id: z.string().uuid(),
  trace_id: z.string().min(1),
  actor_id: z.string().uuid().optional(),
  entity_type: z.enum(entityTypes),
  entity_id: z.string().uuid(),
  occurred_at: utcTimestampSchema,
  produced_at: utcTimestampSchema,
  source: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
});

const customerCreatedPayloadSchema = z.object({
  customer_id: z.string().uuid(),
  external_ref: z.string().min(1),
  email: z.string().email(),
  full_name: z.string().min(1),
  status: z.enum(['active', 'inactive']),
});

const customerUpdatedPayloadSchema = z.object({
  customer_id: z.string().uuid(),
  changed_fields: z.array(z.string().min(1)).min(1),
  status: z.enum(['active', 'inactive']).optional(),
});

const orderCreatedPayloadSchema = z.object({
  order_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  order_number: z.string().min(1),
  status: z.enum(['pending', 'confirmed', 'cancelled']),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

const orderStatusChangedPayloadSchema = z.object({
  order_id: z.string().uuid(),
  previous_status: z.string().min(1),
  new_status: z.string().min(1),
  reason: z.string().min(1).optional(),
});

const agentSessionStartedPayloadSchema = z.object({
  agent_session_id: z.string().uuid(),
  customer_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  channel: z.enum(['api', 'cli', 'worker']),
});

const agentContextRequestedPayloadSchema = z.object({
  agent_session_id: z.string().uuid(),
  request_id: z.string().uuid(),
  query_text: z.string().min(1),
  context_scope: z.array(z.string().min(1)).default([]),
});

const agentResponseGeneratedPayloadSchema = z.object({
  agent_session_id: z.string().uuid(),
  response_id: z.string().uuid(),
  model: z.string().min(1),
  token_count: z.number().int().nonnegative(),
});

const auditRecordedPayloadSchema = z.object({
  audit_log_id: z.string().uuid(),
  agent_session_id: z.string().uuid().optional(),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1),
});

function createEnvelopeSchema<
  TEventType extends EventName,
  TEntityType extends EntityType,
  TPayload extends z.ZodTypeAny,
>(eventType: TEventType, entityType: TEntityType, payload: TPayload) {
  return baseEventMetadataSchema.extend({
    event_type: z.literal(eventType),
    entity_type: z.literal(entityType),
    payload,
  });
}

export const eventSchemaMap = {
  [eventNames.customerCreated]: createEnvelopeSchema(
    eventNames.customerCreated,
    'customer',
    customerCreatedPayloadSchema,
  ),
  [eventNames.customerUpdated]: createEnvelopeSchema(
    eventNames.customerUpdated,
    'customer',
    customerUpdatedPayloadSchema,
  ),
  [eventNames.orderCreated]: createEnvelopeSchema(
    eventNames.orderCreated,
    'order',
    orderCreatedPayloadSchema,
  ),
  [eventNames.orderStatusChanged]: createEnvelopeSchema(
    eventNames.orderStatusChanged,
    'order',
    orderStatusChangedPayloadSchema,
  ),
  [eventNames.agentSessionStarted]: createEnvelopeSchema(
    eventNames.agentSessionStarted,
    'agent_session',
    agentSessionStartedPayloadSchema,
  ),
  [eventNames.agentContextRequested]: createEnvelopeSchema(
    eventNames.agentContextRequested,
    'agent_session',
    agentContextRequestedPayloadSchema,
  ),
  [eventNames.agentResponseGenerated]: createEnvelopeSchema(
    eventNames.agentResponseGenerated,
    'agent_session',
    agentResponseGeneratedPayloadSchema,
  ),
  [eventNames.auditRecorded]: createEnvelopeSchema(
    eventNames.auditRecorded,
    'agent_audit_event',
    auditRecordedPayloadSchema,
  ),
} as const;

export const topicByEventName: Record<EventName, TopicName> = {
  [eventNames.customerCreated]: topicNames.customer,
  [eventNames.customerUpdated]: topicNames.customer,
  [eventNames.orderCreated]: topicNames.order,
  [eventNames.orderStatusChanged]: topicNames.order,
  [eventNames.agentSessionStarted]: topicNames.agent,
  [eventNames.agentContextRequested]: topicNames.agent,
  [eventNames.agentResponseGenerated]: topicNames.agent,
  [eventNames.auditRecorded]: topicNames.audit,
};

export const partitionKeyGuidance: Record<TopicName, string> = {
  'customer-events': 'tenant_id:customer_id',
  'order-events': 'tenant_id:order_id',
  'agent-events': 'tenant_id:agent_session_id',
  'audit-events': 'tenant_id:entity_type:entity_id',
};

export const eventCatalog = {
  [eventNames.customerCreated]: {
    topic: topicNames.customer,
    partitionKey: partitionKeyGuidance['customer-events'],
    description: 'Emitted when a customer record is created.',
  },
  [eventNames.customerUpdated]: {
    topic: topicNames.customer,
    partitionKey: partitionKeyGuidance['customer-events'],
    description: 'Emitted when mutable customer fields change.',
  },
  [eventNames.orderCreated]: {
    topic: topicNames.order,
    partitionKey: partitionKeyGuidance['order-events'],
    description: 'Emitted when a new order is accepted into the platform.',
  },
  [eventNames.orderStatusChanged]: {
    topic: topicNames.order,
    partitionKey: partitionKeyGuidance['order-events'],
    description: 'Emitted when an order transitions between lifecycle states.',
  },
  [eventNames.agentSessionStarted]: {
    topic: topicNames.agent,
    partitionKey: partitionKeyGuidance['agent-events'],
    description: 'Emitted when an agent session begins.',
  },
  [eventNames.agentContextRequested]: {
    topic: topicNames.agent,
    partitionKey: partitionKeyGuidance['agent-events'],
    description: 'Emitted when an agent requests context from the engine.',
  },
  [eventNames.agentResponseGenerated]: {
    topic: topicNames.agent,
    partitionKey: partitionKeyGuidance['agent-events'],
    description: 'Emitted when an agent produces a response after context retrieval.',
  },
  [eventNames.auditRecorded]: {
    topic: topicNames.audit,
    partitionKey: partitionKeyGuidance['audit-events'],
    description: 'Emitted when a durable audit record is written.',
  },
} as const;

export const eventEnvelopeSchema = z.discriminatedUnion('event_type', [
  eventSchemaMap[eventNames.customerCreated],
  eventSchemaMap[eventNames.customerUpdated],
  eventSchemaMap[eventNames.orderCreated],
  eventSchemaMap[eventNames.orderStatusChanged],
  eventSchemaMap[eventNames.agentSessionStarted],
  eventSchemaMap[eventNames.agentContextRequested],
  eventSchemaMap[eventNames.agentResponseGenerated],
  eventSchemaMap[eventNames.auditRecorded],
]);

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type EventCatalog = typeof eventCatalog;

export interface PublishableEvent {
  topic: TopicName;
  key: string;
  event: EventEnvelope;
  headers?: Record<string, string>;
}

export interface EventPublisher {
  publish(message: PublishableEvent): Promise<void>;
  disconnect?(): Promise<void>;
}

export function validateEventEnvelope(input: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(input);
}

export async function createKafkaEventPublisher(config: {
  clientId: string;
  brokers: string[];
}): Promise<EventPublisher> {
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
  });

  const producer: Producer = kafka.producer();
  await producer.connect();

  return {
    async publish(message) {
      await producer.send({
        topic: message.topic,
        messages: [
          {
            key: message.key,
            value: JSON.stringify(message.event),
            headers: message.headers,
          },
        ],
      });
    },
    async disconnect() {
      await producer.disconnect();
    },
  };
}
