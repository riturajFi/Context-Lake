import {
  createDbPool,
} from '@context-lake/shared-db';
import { checkMinio, checkPostgres, checkRedis, loadConfig, z } from '@context-lake/shared-config';
import { createHttpApp } from '@context-lake/shared-http';
import type { HealthStatus } from '@context-lake/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  batchContextRequestSchema,
  contextQuerySchema,
  tenantHeaderSchema,
  uuidParamSchema,
} from './contracts.js';
import { ApiError } from './errors.js';
import { ContextQueryMetrics } from './metrics.js';
import { ContextQueryService } from './service.js';

export const contextQueryConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  HOST: z.string().default('0.0.0.0'),
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().positive().default(150),
});

export type ContextQueryConfig = ReturnType<typeof loadContextQueryConfig>;

interface ContextQueryAppDependencies {
  pool?: ReturnType<typeof createDbPool>;
}

export function loadContextQueryConfig() {
  return loadConfig(contextQueryConfigSchema);
}

export async function createContextQueryApp(
  config = loadContextQueryConfig(),
  dependencies: ContextQueryAppDependencies = {},
) {
  const app = createHttpApp({
    serviceName: 'context-query-api',
    logLevel: config.LOG_LEVEL,
  });
  const pool = dependencies.pool ?? createDbPool(config.POSTGRES_URL);
  const metrics = new ContextQueryMetrics();
  const service = new ContextQueryService({
    pool,
    logger: app.log,
    metrics,
    slowQueryThresholdMs: config.SLOW_QUERY_THRESHOLD_MS,
  });

  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { contextStartedAtMs?: number }).contextStartedAtMs = Date.now();
  });

  app.addHook('onResponse', async (request) => {
    const startedAt = (request as FastifyRequest & { contextStartedAtMs?: number }).contextStartedAtMs;
    if (!startedAt) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    metrics.recordRequestDuration(durationMs);

    if (durationMs >= config.SLOW_QUERY_THRESHOLD_MS) {
      metrics.incrementSlowRequests();
      app.log.warn(
        {
          path: request.routeOptions.url,
          method: request.method,
          duration_ms: durationMs,
          trace_id: request.id,
          tenant_id: request.headers['x-tenant-id'] ?? null,
        },
        'slow request',
      );
    }
  });

  async function getDependencyChecks() {
    const checks = await Promise.allSettled([
      checkPostgres(config.POSTGRES_URL),
      checkRedis(config.REDIS_URL),
      checkMinio({
        endPoint: config.MINIO_ENDPOINT,
        port: config.MINIO_PORT,
        useSSL: config.MINIO_USE_SSL,
        accessKey: config.MINIO_ACCESS_KEY,
        secretKey: config.MINIO_SECRET_KEY,
      }),
    ]);

    const projectionChecks = await Promise.allSettled([
      pool.query('select 1 from customer_context_view limit 1'),
      pool.query('select 1 from order_context_view limit 1'),
      pool.query('select 1 from agent_session_context_view limit 1'),
    ]);

    return {
      postgres: checks[0].status === 'fulfilled' ? 'up' : 'down',
      redis: checks[1].status === 'fulfilled' ? 'up' : 'down',
      minio: checks[2].status === 'fulfilled' ? 'up' : 'down',
      projections:
        projectionChecks.every((check) => check.status === 'fulfilled') ? 'up' : 'down',
    } as const;
  }

  function getTenantId(request: FastifyRequest) {
    const tenantHeader = request.headers['x-tenant-id'];
    if (!tenantHeader) {
      throw new ApiError(400, 'MISSING_TENANT_ID', 'x-tenant-id header is required');
    }

    return tenantHeaderSchema.parse(tenantHeader);
  }

  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks = await getDependencyChecks();
    const status: HealthStatus & { metrics: ReturnType<typeof metrics.snapshot> } = {
      status: Object.values(checks).every((value) => value === 'up') ? 'ok' : 'degraded',
      service: 'context-query-api',
      checks,
      timestamp: new Date().toISOString(),
      metrics: metrics.snapshot(),
    };

    reply.code(status.status === 'ok' ? 200 : 503);
    return status;
  });

  app.get('/context/customer/:customerId', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const params = request.params as { customerId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await service.getCustomerContext(
        uuidParamSchema.parse(params.customerId),
        {
          tenantId,
          traceId: request.id,
        },
        {
          auditLimit: query.audit_limit,
          relatedLimit: query.related_limit,
        },
      );

      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.get('/context/order/:orderId', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const params = request.params as { orderId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await service.getOrderContext(
        uuidParamSchema.parse(params.orderId),
        {
          tenantId,
          traceId: request.id,
        },
        {
          auditLimit: query.audit_limit,
          relatedLimit: query.related_limit,
        },
      );

      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.get('/context/agent-session/:sessionId', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const params = request.params as { sessionId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await service.getAgentSessionContext(
        uuidParamSchema.parse(params.sessionId),
        {
          tenantId,
          traceId: request.id,
        },
        {
          auditLimit: query.audit_limit,
          relatedLimit: query.related_limit,
        },
      );

      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.post('/context/batch', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const payload = batchContextRequestSchema.parse(request.body);
      const result = await service.getBatchContext(
        payload.items,
        {
          tenantId,
          traceId: request.id,
        },
        {
          auditLimit: payload.audit_limit,
          relatedLimit: payload.related_limit,
        },
      );

      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}

function handleApiError(error: unknown, reply: FastifyReply, traceId: string) {
  if (error instanceof ApiError) {
    reply.code(error.statusCode);
    return {
      error: {
        code: error.code,
        message: error.message,
        trace_id: traceId,
      },
    };
  }

  if (error instanceof z.ZodError) {
    reply.code(400);
    return {
      error: {
        code: 'VALIDATION_ERROR' as const,
        message: error.issues.map((issue) => issue.message).join('; '),
        trace_id: traceId,
      },
    };
  }

  reply.code(500);
  return {
    error: {
      code: 'INTERNAL_ERROR' as const,
      message: 'internal server error',
      trace_id: traceId,
    },
  };
}
