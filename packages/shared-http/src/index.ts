import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { z } from '@context-lake/shared-config';
import { createLogger } from '@context-lake/shared-logging';
import { getPrometheusMetrics, type Registry } from '@context-lake/shared-observability';
import type { ServiceName } from '@context-lake/shared-types';

export interface HttpAppOptions {
  serviceName: ServiceName;
  logLevel?: string;
}

export interface ApiAuthToken {
  token_id: string;
  token: string;
  tenant_ids: '*' | string[];
  actor_id?: string;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  tenantId?: string;
  actorId?: string;
  tokenId?: string;
  serviceName: ServiceName;
  timestamp: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    contextLake: RequestContext;
  }
}

class GovernanceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createHttpApp({
  serviceName,
  logLevel,
}: HttpAppOptions): FastifyInstance {
  const logger = createLogger(serviceName, logLevel) as FastifyBaseLogger;
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId(request) {
      return request.headers['x-request-id']?.toString() ?? crypto.randomUUID();
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    const traceId = request.headers['x-trace-id']?.toString() ?? request.id;
    reply.header('x-request-id', request.id);
    reply.header('x-trace-id', traceId);
    request.contextLake = {
      requestId: request.id,
      traceId,
      serviceName,
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

export function parseApiAuthTokens(input: string) {
  if (!input.trim()) {
    return [];
  }

  return z
    .array(
      z.object({
        token_id: z.string().min(1),
        token: z.string().min(8),
        tenant_ids: z.union([z.literal('*'), z.array(z.string().uuid()).min(1)]),
        actor_id: z.string().uuid().optional(),
      }),
    )
    .parse(JSON.parse(input)) as ApiAuthToken[];
}

export function registerApiGovernance(
  app: FastifyInstance,
  options: {
    authTokens: ApiAuthToken[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    exemptPaths?: string[];
  },
) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const exemptPaths = new Set(options.exemptPaths ?? ['/health', '/metrics']);

  app.addHook('onRequest', async (request, reply) => {
    const routePath = request.routeOptions.url ?? request.url;

    if (exemptPaths.has(routePath)) {
      return;
    }

    const rawToken =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ??
      request.headers['x-api-key']?.toString();

    if (!rawToken) {
      throw new GovernanceError(401, 'AUTH_REQUIRED', 'authorization is required');
    }

    const principal = options.authTokens.find((token) => token.token === rawToken);
    if (!principal) {
      throw new GovernanceError(401, 'AUTH_INVALID', 'authorization is invalid');
    }

    const tenantHeader = request.headers['x-tenant-id'];
    if (!tenantHeader) {
      throw new GovernanceError(400, 'MISSING_TENANT_ID', 'x-tenant-id header is required');
    }

    const tenantId = z.string().uuid().parse(tenantHeader.toString());

    if (principal.tenant_ids !== '*' && !principal.tenant_ids.includes(tenantId)) {
      throw new GovernanceError(
        403,
        'TENANT_FORBIDDEN',
        'token is not allowed for the requested tenant',
      );
    }

    const bucketKey = `${principal.token_id}:${tenantId}:${routePath}`;
    const now = Date.now();
    const bucket = buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(bucketKey, {
        count: 1,
        resetAt: now + options.rateLimitWindowMs,
      });
    } else {
      bucket.count += 1;
      if (bucket.count > options.rateLimitMaxRequests) {
        reply.header('retry-after', Math.ceil((bucket.resetAt - now) / 1000));
        throw new GovernanceError(429, 'RATE_LIMITED', 'rate limit exceeded');
      }
    }

    const actorHeader = request.headers['x-actor-id'];
    const actorId = actorHeader
      ? z.string().uuid().parse(actorHeader.toString())
      : principal.actor_id;

    request.contextLake = {
      ...request.contextLake,
      tenantId,
      actorId,
      tokenId: principal.token_id,
    };
  });
}

export function registerPrometheusEndpoint(app: FastifyInstance, registry: Registry) {
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return getPrometheusMetrics(registry);
  });
}

export function formatApiError(traceId: string, code: string, message: string) {
  return {
    error: {
      code,
      message,
      trace_id: traceId,
    },
  };
}

export function isGovernanceError(error: unknown): error is GovernanceError {
  return error instanceof GovernanceError;
}

export interface ContextQueryClientOptions {
  baseUrl: string;
  tenantId: string;
  token: string;
  defaultHeaders?: Record<string, string>;
}

export function createContextQueryClient(options: ContextQueryClientOptions) {
  async function send<T>(input: string, init: RequestInit = {}) {
    const response = await fetch(new URL(input, options.baseUrl), {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
        'x-tenant-id': options.tenantId,
        ...options.defaultHeaders,
        ...(init.headers ?? {}),
      },
    });
    const body = (await response.json()) as T;

    if (!response.ok) {
      throw new Error(`context-query-api request failed with status ${response.status}`);
    }

    return body;
  }

  return {
    getCustomerContext(customerId: string, query?: { audit_limit?: number; related_limit?: number }) {
      const search = new URLSearchParams();

      if (query?.audit_limit) {
        search.set('audit_limit', String(query.audit_limit));
      }

      if (query?.related_limit) {
        search.set('related_limit', String(query.related_limit));
      }

      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      return send(`/context/customer/${customerId}${suffix}`);
    },

    getOrderContext(orderId: string, query?: { audit_limit?: number; related_limit?: number }) {
      const search = new URLSearchParams();

      if (query?.audit_limit) {
        search.set('audit_limit', String(query.audit_limit));
      }

      if (query?.related_limit) {
        search.set('related_limit', String(query.related_limit));
      }

      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      return send(`/context/order/${orderId}${suffix}`);
    },

    getAgentSessionContext(
      sessionId: string,
      query?: { audit_limit?: number; related_limit?: number },
    ) {
      const search = new URLSearchParams();

      if (query?.audit_limit) {
        search.set('audit_limit', String(query.audit_limit));
      }

      if (query?.related_limit) {
        search.set('related_limit', String(query.related_limit));
      }

      const suffix = search.size > 0 ? `?${search.toString()}` : '';
      return send(`/context/agent-session/${sessionId}${suffix}`);
    },

    batch(payload: {
      items: Array<{ entity_type: 'customer' | 'order' | 'agent_session'; entity_id: string }>;
      audit_limit?: number;
      related_limit?: number;
    }) {
      return send('/context/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  };
}
