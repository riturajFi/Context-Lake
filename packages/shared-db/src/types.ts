import type { EntityType, TopicName } from '@context-lake/shared-types';

export interface CustomerRow {
  id: string;
  tenant_id: string;
  external_ref: string;
  email: string;
  full_name: string;
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  order_number: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  amount_cents: number;
  currency: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  order_id: string | null;
  status: 'active' | 'completed' | 'failed';
  trace_id: string;
  channel: 'api' | 'cli' | 'worker';
  context_summary: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentAuditLogRow {
  id: string;
  tenant_id: string;
  agent_session_id: string | null;
  event_type: string;
  actor_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  trace_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface IngestionRequestRow {
  id: string;
  tenant_id: string;
  source: string;
  request_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  trace_id: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  resource_type: string | null;
  resource_id: string | null;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourcePointer {
  resource_type: 'customer' | 'order' | 'agent_session';
  resource_id: string;
}

export interface IdempotencyKeyRow {
  id: string;
  tenant_id: string;
  scope: string;
  idempotency_key: string;
  request_hash: string;
  resource_type: string | null;
  resource_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string | null;
  created_at: string;
}

export interface OutboxEventRow {
  event_id: string;
  tenant_id: string;
  topic: TopicName;
  partition_key: string;
  event_name: string;
  event_version: number;
  trace_id: string;
  actor_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  occurred_at: string;
  available_at: string;
  publish_status: 'pending' | 'processing' | 'published' | 'failed';
  attempt_count: number;
  last_error: string | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string;
}

export interface CustomerContextViewRow {
  tenant_id: string;
  customer_id: string;
  external_ref: string;
  email: string;
  full_name: string;
  status: string;
  customer_metadata: Record<string, unknown>;
  source_event_id: string;
  source_event_version: number;
  source_occurred_at: string | Date;
  projection_updated_at: string | Date;
}

export interface OrderContextViewRow {
  tenant_id: string;
  order_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  amount_cents: number;
  currency: string;
  order_metadata: Record<string, unknown>;
  source_event_id: string;
  source_event_version: number;
  source_occurred_at: string | Date;
  projection_updated_at: string | Date;
}

export interface AgentSessionContextViewRow {
  tenant_id: string;
  agent_session_id: string;
  customer_id: string | null;
  order_id: string | null;
  status: string | null;
  channel: string | null;
  last_context_request_id: string | null;
  last_context_query_text: string | null;
  last_context_scope: unknown[];
  last_response_id: string | null;
  last_response_model: string | null;
  last_response_token_count: number | null;
  session_summary: Record<string, unknown>;
  source_event_id: string;
  source_event_version: number;
  source_occurred_at: string | Date;
  projection_updated_at: string | Date;
}

export interface ProjectionEventApplicationRow {
  consumer_name: string;
  topic: string;
  partition: number;
  kafka_offset: string;
  event_id: string;
  event_type: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  processed_at: string | Date;
}

export interface ProjectionDeadLetterRow {
  id: string;
  consumer_name: string;
  topic: string;
  partition: number;
  kafka_offset: string;
  event_id: string | null;
  event_type: string | null;
  tenant_id: string | null;
  trace_id: string | null;
  failure_reason: string;
  payload: Record<string, unknown>;
  created_at: string | Date;
}

export interface ContextAuditReferenceRow {
  id: string;
  tenant_id: string;
  agent_session_id: string | null;
  event_type: string;
  actor_id: string | null;
  entity_type: EntityType;
  entity_id: string;
  trace_id: string;
  occurred_at: string | Date;
  created_at: string | Date;
  payload_summary: Record<string, unknown>;
}
