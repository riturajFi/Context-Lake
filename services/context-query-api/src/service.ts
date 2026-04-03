import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';

import { createRepositoryContext } from '@context-lake/shared-db';
import type {
  AgentSessionContextViewRow,
  ContextAuditReferenceRow,
  CustomerContextViewRow,
  OrderContextViewRow,
} from '@context-lake/shared-db';

import { ApiError } from './errors.js';
import { ContextQueryMetrics } from './metrics.js';

const DEFAULT_AUDIT_LIMIT = 5;
const MAX_AUDIT_LIMIT = 20;
const DEFAULT_RELATED_LIMIT = 5;
const MAX_RELATED_LIMIT = 25;

export interface QueryRequestContext {
  tenantId: string;
  traceId: string;
}

export interface ContextRequestOptions {
  auditLimit?: number;
  relatedLimit?: number;
}

interface ContextServiceOptions {
  pool: Pool;
  logger: FastifyBaseLogger;
  metrics: ContextQueryMetrics;
  slowQueryThresholdMs: number;
}

interface HistoryMetadata {
  source_event_id: string;
  source_event_version: number;
  source_occurred_at: string;
  projection_updated_at: string;
}

interface AuditReference {
  audit_id: string;
  event_type: string;
  actor_id: string | null;
  trace_id: string;
  occurred_at: string;
  created_at: string;
  agent_session_id: string | null;
  entity_type: string;
  entity_id: string;
  payload_summary: Record<string, unknown>;
}

interface CustomerSummary {
  customer_id: string;
  external_ref: string;
  email: string;
  full_name: string;
  status: string;
  metadata: Record<string, unknown>;
  history: HistoryMetadata;
}

interface OrderSummary {
  order_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  amount_cents: number;
  currency: string;
  metadata: Record<string, unknown>;
  history: HistoryMetadata;
}

interface AgentSessionSummary {
  session_id: string;
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
  history: HistoryMetadata;
}

export interface CustomerContextResponse {
  trace_id: string;
  tenant_id: string;
  entity_type: 'customer';
  customer: CustomerSummary;
  related: {
    recent_orders: OrderSummary[];
    recent_agent_sessions: AgentSessionSummary[];
  };
  audit_references: AuditReference[];
}

export interface OrderContextResponse {
  trace_id: string;
  tenant_id: string;
  entity_type: 'order';
  order: OrderSummary;
  related: {
    customer: CustomerSummary | null;
    recent_agent_sessions: AgentSessionSummary[];
  };
  audit_references: AuditReference[];
}

export interface AgentSessionContextResponse {
  trace_id: string;
  tenant_id: string;
  entity_type: 'agent_session';
  agent_session: AgentSessionSummary;
  related: {
    customer: CustomerSummary | null;
    order: OrderSummary | null;
  };
  audit_references: AuditReference[];
}

export type ContextEntityResponse =
  | CustomerContextResponse
  | OrderContextResponse
  | AgentSessionContextResponse;

export class ContextQueryService {
  constructor(private readonly options: ContextServiceOptions) {}

  async getCustomerContext(
    customerId: string,
    context: QueryRequestContext,
    options: ContextRequestOptions = {},
  ): Promise<CustomerContextResponse> {
    this.options.metrics.incrementContextRequests();
    const repos = createRepositoryContext(this.options.pool);
    const auditLimit = normalizeLimit(options.auditLimit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
    const relatedLimit = normalizeLimit(
      options.relatedLimit,
      DEFAULT_RELATED_LIMIT,
      MAX_RELATED_LIMIT,
    );

    const startedAt = Date.now();
    const [customer, recentOrders, recentSessions, auditReferences] = await Promise.all([
      repos.customerContextView.findById(context.tenantId, customerId),
      repos.orderContextView.listByCustomerId(context.tenantId, customerId, relatedLimit),
      repos.agentSessionContextView.listByCustomerId(context.tenantId, customerId, relatedLimit),
      repos.agentAuditLogs.listRecentByEntity(context.tenantId, 'customer', customerId, auditLimit),
    ]);

    this.logSlowQuery('customer_context', context, startedAt, { customerId });

    if (!customer) {
      this.options.metrics.incrementNotFound();
      throw new ApiError(404, 'NOT_FOUND', 'customer context not found');
    }

    return {
      trace_id: context.traceId,
      tenant_id: context.tenantId,
      entity_type: 'customer',
      customer: mapCustomer(customer),
      related: {
        recent_orders: recentOrders.map(mapOrder),
        recent_agent_sessions: recentSessions.map(mapAgentSession),
      },
      audit_references: auditReferences.map(mapAuditReference),
    };
  }

  async getOrderContext(
    orderId: string,
    context: QueryRequestContext,
    options: ContextRequestOptions = {},
  ): Promise<OrderContextResponse> {
    this.options.metrics.incrementContextRequests();
    const repos = createRepositoryContext(this.options.pool);
    const auditLimit = normalizeLimit(options.auditLimit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
    const relatedLimit = normalizeLimit(
      options.relatedLimit,
      DEFAULT_RELATED_LIMIT,
      MAX_RELATED_LIMIT,
    );

    const startedAt = Date.now();
    const order = await repos.orderContextView.findById(context.tenantId, orderId);
    if (!order) {
      this.logSlowQuery('order_context', context, startedAt, { orderId });
      this.options.metrics.incrementNotFound();
      throw new ApiError(404, 'NOT_FOUND', 'order context not found');
    }

    const [customer, recentSessions, auditReferences] = await Promise.all([
      repos.customerContextView.findById(context.tenantId, order.customer_id),
      repos.agentSessionContextView.listByOrderId(context.tenantId, orderId, relatedLimit),
      repos.agentAuditLogs.listRecentByEntity(context.tenantId, 'order', orderId, auditLimit),
    ]);

    this.logSlowQuery('order_context', context, startedAt, { orderId });

    return {
      trace_id: context.traceId,
      tenant_id: context.tenantId,
      entity_type: 'order',
      order: mapOrder(order),
      related: {
        customer: customer ? mapCustomer(customer) : null,
        recent_agent_sessions: recentSessions.map(mapAgentSession),
      },
      audit_references: auditReferences.map(mapAuditReference),
    };
  }

  async getAgentSessionContext(
    sessionId: string,
    context: QueryRequestContext,
    options: ContextRequestOptions = {},
  ): Promise<AgentSessionContextResponse> {
    this.options.metrics.incrementContextRequests();
    const repos = createRepositoryContext(this.options.pool);
    const auditLimit = normalizeLimit(options.auditLimit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);

    const startedAt = Date.now();
    const session = await repos.agentSessionContextView.findById(context.tenantId, sessionId);
    if (!session) {
      this.logSlowQuery('agent_session_context', context, startedAt, { sessionId });
      this.options.metrics.incrementNotFound();
      throw new ApiError(404, 'NOT_FOUND', 'agent session context not found');
    }

    const [customer, order, auditReferences] = await Promise.all([
      session.customer_id
        ? repos.customerContextView.findById(context.tenantId, session.customer_id)
        : Promise.resolve(null),
      session.order_id
        ? repos.orderContextView.findById(context.tenantId, session.order_id)
        : Promise.resolve(null),
      repos.agentAuditLogs.listRecentBySessionId(context.tenantId, sessionId, auditLimit),
    ]);

    this.logSlowQuery('agent_session_context', context, startedAt, { sessionId });

    return {
      trace_id: context.traceId,
      tenant_id: context.tenantId,
      entity_type: 'agent_session',
      agent_session: mapAgentSession(session),
      related: {
        customer: customer ? mapCustomer(customer) : null,
        order: order ? mapOrder(order) : null,
      },
      audit_references: auditReferences.map(mapAuditReference),
    };
  }

  async getBatchContext(
    items: Array<{ entity_type: 'customer' | 'order' | 'agent_session'; entity_id: string }>,
    context: QueryRequestContext,
    options: ContextRequestOptions = {},
  ) {
    this.options.metrics.incrementBatchRequests();
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          switch (item.entity_type) {
            case 'customer':
              return await this.getCustomerContext(item.entity_id, context, options);
            case 'order':
              return await this.getOrderContext(item.entity_id, context, options);
            case 'agent_session':
              return await this.getAgentSessionContext(item.entity_id, context, options);
          }
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND') {
            return null;
          }

          throw error;
        }
      }),
    );

    const missing = items.filter((_item, index) => results[index] === null);

    return {
      trace_id: context.traceId,
      tenant_id: context.tenantId,
      items: results.filter((result): result is ContextEntityResponse => result !== null),
      missing,
    };
  }

  private logSlowQuery(
    operation: string,
    context: QueryRequestContext,
    startedAt: number,
    resource: Record<string, unknown>,
  ) {
    const durationMs = Date.now() - startedAt;

    if (durationMs >= this.options.slowQueryThresholdMs) {
      this.options.logger.warn(
        {
          operation,
          duration_ms: durationMs,
          tenant_id: context.tenantId,
          trace_id: context.traceId,
          ...resource,
        },
        'slow context query',
      );
    }
  }
}

function normalizeLimit(input: number | undefined, fallback: number, max: number) {
  if (!input) {
    return fallback;
  }

  return Math.min(Math.max(input, 1), max);
}

function mapHistory(row: {
  source_event_id: string;
  source_event_version: number;
  source_occurred_at: string | Date;
  projection_updated_at: string | Date;
}): HistoryMetadata {
  return {
    source_event_id: row.source_event_id,
    source_event_version: row.source_event_version,
    source_occurred_at: serializeDate(row.source_occurred_at),
    projection_updated_at: serializeDate(row.projection_updated_at),
  };
}

function mapCustomer(row: CustomerContextViewRow): CustomerSummary {
  return {
    customer_id: row.customer_id,
    external_ref: row.external_ref,
    email: row.email,
    full_name: row.full_name,
    status: row.status,
    metadata: row.customer_metadata,
    history: mapHistory(row),
  };
}

function mapOrder(row: OrderContextViewRow): OrderSummary {
  return {
    order_id: row.order_id,
    customer_id: row.customer_id,
    order_number: row.order_number,
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    metadata: row.order_metadata,
    history: mapHistory(row),
  };
}

function mapAgentSession(row: AgentSessionContextViewRow): AgentSessionSummary {
  return {
    session_id: row.agent_session_id,
    customer_id: row.customer_id,
    order_id: row.order_id,
    status: row.status,
    channel: row.channel,
    last_context_request_id: row.last_context_request_id,
    last_context_query_text: row.last_context_query_text,
    last_context_scope: row.last_context_scope,
    last_response_id: row.last_response_id,
    last_response_model: row.last_response_model,
    last_response_token_count: row.last_response_token_count,
    session_summary: row.session_summary,
    history: mapHistory(row),
  };
}

function mapAuditReference(row: ContextAuditReferenceRow): AuditReference {
  return {
    audit_id: row.id,
    event_type: row.event_type,
    actor_id: row.actor_id,
    trace_id: row.trace_id,
    occurred_at: serializeDate(row.occurred_at),
    created_at: serializeDate(row.created_at),
    agent_session_id: row.agent_session_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    payload_summary: {
      message: row.payload_summary.message ?? null,
      severity: row.payload_summary.severity ?? null,
    },
  };
}

function serializeDate(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}
