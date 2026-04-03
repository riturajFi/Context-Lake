import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { createLogger } from '@context-lake/shared-logging';
import type { ServiceName } from '@context-lake/shared-types';

export interface HttpAppOptions {
  serviceName: ServiceName;
  logLevel?: string;
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
    reply.header('x-request-id', request.id);
  });

  return app;
}

export interface ContextQueryClientOptions {
  baseUrl: string;
  tenantId: string;
  defaultHeaders?: Record<string, string>;
}

export function createContextQueryClient(options: ContextQueryClientOptions) {
  async function send<T>(input: string, init: RequestInit = {}) {
    const response = await fetch(new URL(input, options.baseUrl), {
      ...init,
      headers: {
        'content-type': 'application/json',
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
