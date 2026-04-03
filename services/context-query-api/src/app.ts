import {
  createDbPool,
} from '@context-lake/shared-db';
import { checkMinio, checkPostgres, checkRedis, loadConfig, z } from '@context-lake/shared-config';
import {
  createHttpApp,
  formatApiError,
  isGovernanceError,
  parseApiAuthTokens,
  registerApiGovernance,
  registerPrometheusEndpoint,
} from '@context-lake/shared-http';
import {
  Counter,
  Gauge,
  Histogram,
  createMetricsRegistry,
  withActiveSpan,
} from '@context-lake/shared-observability';
import type { HealthStatus } from '@context-lake/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ContextAuditPublisher } from './audit.js';
import {
  batchContextRequestSchema,
  contextQuerySchema,
  uuidParamSchema,
} from './contracts.js';
import { ApiError } from './errors.js';
import { ContextQueryMetrics } from './metrics.js';
import { ContextQueryService } from './service.js';

export const contextQueryConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  HOST: z.string().default('0.0.0.0'),
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().positive().default(150),
  API_AUTH_TOKENS_JSON: z.string().min(2),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
});

export type ContextQueryConfig = ReturnType<typeof loadContextQueryConfig>;

interface ContextQueryAppDependencies {
  pool?: ReturnType<typeof createDbPool>;
  auditPublisher?: ContextAuditPublisher;
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
  const registry = createMetricsRegistry('context-query-api');
  const requestDurationMs = new Histogram({
    name: 'context_query_api_request_duration_ms',
    help: 'Context query API request duration in milliseconds.',
    labelNames: ['route', 'method', 'status_code'],
    buckets: [5, 15, 50, 100, 250, 500, 1000, 3000],
    registers: [registry],
  });
  const requestTotal = new Counter({
    name: 'context_query_api_requests_total',
    help: 'Total context query API requests.',
    labelNames: ['route', 'method', 'status_code'],
    registers: [registry],
  });
  const auditPublishTotal = new Counter({
    name: 'context_query_api_audit_publish_total',
    help: 'Total audit publish attempts by outcome.',
    labelNames: ['status'],
    registers: [registry],
  });
  const dbPoolConnections = new Gauge({
    name: 'context_query_api_db_pool_connections',
    help: 'Database pool connections by state.',
    labelNames: ['state'],
    registers: [registry],
  });
  const auditPublisher =
    dependencies.auditPublisher ??
    (await ContextAuditPublisher.create(config.KAFKA_BROKERS.split(',')));
  const service = new ContextQueryService({
    pool,
    logger: app.log,
    metrics,
    slowQueryThresholdMs: config.SLOW_QUERY_THRESHOLD_MS,
    auditPublisher,
    serviceName: 'context-query-api',
  });

  registerApiGovernance(app, {
    authTokens: parseApiAuthTokens(config.API_AUTH_TOKENS_JSON),
    rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  });
  registerPrometheusEndpoint(app, registry);

  app.setErrorHandler((error, request, reply) => {
    if (isGovernanceError(error)) {
      metrics.incrementAuthFailures();
      reply.code(error.statusCode);
      return reply.send(formatApiError(request.id, error.code, error.message));
    }

    if (error instanceof z.ZodError) {
      reply.code(400);
      return reply.send(
        formatApiError(
          request.id,
          'VALIDATION_ERROR',
          error.issues.map((issue) => issue.message).join('; '),
        ),
      );
    }

    if (error instanceof ApiError) {
      reply.code(error.statusCode);
      return reply.send(formatApiError(request.id, error.code, error.message));
    }

    reply.code(500);
    return reply.send(formatApiError(request.id, 'INTERNAL_ERROR', 'internal server error'));
  });

  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { contextStartedAtMs?: number }).contextStartedAtMs = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as FastifyRequest & { contextStartedAtMs?: number }).contextStartedAtMs;
    if (!startedAt) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    metrics.recordRequestDuration(durationMs);
    requestDurationMs.observe(
      {
        route: request.routeOptions.url,
        method: request.method,
        status_code: String(reply.statusCode),
      },
      durationMs,
    );
    requestTotal.inc({
      route: request.routeOptions.url,
      method: request.method,
      status_code: String(reply.statusCode),
    });
    auditPublishTotal.inc({
      status: 'success',
    }, 0);
    dbPoolConnections.set({ state: 'total' }, pool.totalCount);
    dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
    dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);

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
      const params = request.params as { customerId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await withActiveSpan(
        'context-query-api',
        'context.customer.read',
        {
          tenant_id: request.contextLake.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.getCustomerContext(
            uuidParamSchema.parse(params.customerId),
            {
              tenantId: request.contextLake.tenantId!,
              traceId: request.contextLake.traceId,
              requestId: request.contextLake.requestId,
              actorId: request.contextLake.actorId,
              timestamp: request.contextLake.timestamp,
            },
            {
              auditLimit: query.audit_limit,
              relatedLimit: query.related_limit,
            },
          ),
      );

      auditPublishTotal.inc({ status: 'success' });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUDIT_UNAVAILABLE') {
        auditPublishTotal.inc({ status: 'failure' });
      }
      return handleApiError(error, reply, request.id);
    }
  });

  app.get('/context/order/:orderId', async (request, reply) => {
    try {
      const params = request.params as { orderId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await withActiveSpan(
        'context-query-api',
        'context.order.read',
        {
          tenant_id: request.contextLake.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.getOrderContext(
            uuidParamSchema.parse(params.orderId),
            {
              tenantId: request.contextLake.tenantId!,
              traceId: request.contextLake.traceId,
              requestId: request.contextLake.requestId,
              actorId: request.contextLake.actorId,
              timestamp: request.contextLake.timestamp,
            },
            {
              auditLimit: query.audit_limit,
              relatedLimit: query.related_limit,
            },
          ),
      );

      auditPublishTotal.inc({ status: 'success' });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUDIT_UNAVAILABLE') {
        auditPublishTotal.inc({ status: 'failure' });
      }
      return handleApiError(error, reply, request.id);
    }
  });

  app.get('/context/agent-session/:sessionId', async (request, reply) => {
    try {
      const params = request.params as { sessionId: string };
      const query = contextQuerySchema.parse(request.query ?? {});
      const result = await withActiveSpan(
        'context-query-api',
        'context.agent_session.read',
        {
          tenant_id: request.contextLake.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.getAgentSessionContext(
            uuidParamSchema.parse(params.sessionId),
            {
              tenantId: request.contextLake.tenantId!,
              traceId: request.contextLake.traceId,
              requestId: request.contextLake.requestId,
              actorId: request.contextLake.actorId,
              timestamp: request.contextLake.timestamp,
            },
            {
              auditLimit: query.audit_limit,
              relatedLimit: query.related_limit,
            },
          ),
      );

      auditPublishTotal.inc({ status: 'success' });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUDIT_UNAVAILABLE') {
        auditPublishTotal.inc({ status: 'failure' });
      }
      return handleApiError(error, reply, request.id);
    }
  });

  app.post('/context/batch', async (request, reply) => {
    try {
      const payload = batchContextRequestSchema.parse(request.body);
      const result = await withActiveSpan(
        'context-query-api',
        'context.batch.read',
        {
          tenant_id: request.contextLake.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.getBatchContext(
            payload.items,
            {
              tenantId: request.contextLake.tenantId!,
              traceId: request.contextLake.traceId,
              requestId: request.contextLake.requestId,
              actorId: request.contextLake.actorId,
              timestamp: request.contextLake.timestamp,
            },
            {
              auditLimit: payload.audit_limit,
              relatedLimit: payload.related_limit,
            },
          ),
      );

      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.addHook('onClose', async () => {
    await auditPublisher.disconnect();
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
