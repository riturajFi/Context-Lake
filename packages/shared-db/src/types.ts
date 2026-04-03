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
  requested_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
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
