import { randomUUID } from 'node:crypto';

import {
  createKafkaEventPublisher,
  eventNames,
  topicNames,
  type EventEnvelope,
  type EventPublisher,
} from '@context-lake/shared-events';

export interface PublishContextAccessInput {
  tenantId: string;
  actorId?: string;
  traceId: string;
  requestId: string;
  entityType: 'customer' | 'order' | 'agent_session';
  entityId: string;
  serviceName: string;
  timestamp: string;
  agentSessionId?: string;
}

export class ContextAuditPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  static async create(brokers: string[]) {
    const publisher = await createKafkaEventPublisher({
      clientId: 'context-lake-context-query-audit',
      brokers,
    });

    return new ContextAuditPublisher(publisher);
  }

  async publishContextAccess(input: PublishContextAccessInput) {
    const event: EventEnvelope = {
      event_id: randomUUID(),
      request_id: input.requestId,
      event_type: eventNames.auditRecorded,
      event_version: 1,
      tenant_id: input.tenantId,
      trace_id: input.traceId,
      actor_id: input.actorId,
      entity_type: 'agent_audit_event',
      entity_id: randomUUID(),
      occurred_at: input.timestamp,
      produced_at: new Date().toISOString(),
      source: input.serviceName,
      payload: {
        audit_log_id: randomUUID(),
        agent_session_id: input.agentSessionId,
        action: 'context.accessed',
        audited_entity_type: input.entityType,
        audited_entity_id: input.entityId,
        request_id: input.requestId,
        service_name: input.serviceName,
        trace_path: [
          {
            service_name: input.serviceName,
            trace_id: input.traceId,
            request_id: input.requestId,
            timestamp: input.timestamp,
          },
        ],
        severity: 'info',
        message: `context accessed for ${input.entityType}`,
        metadata: {
          request_id: input.requestId,
        },
      },
    };

    await this.publisher.publish({
      topic: topicNames.audit,
      key: `${input.tenantId}:${input.entityType}:${input.entityId}`,
      event,
    });
  }

  async disconnect() {
    await this.publisher.disconnect?.();
  }
}
