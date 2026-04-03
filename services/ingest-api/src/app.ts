import {
  checkKafka,
  checkMinio,
  checkPostgres,
  checkRedis,
  loadConfig,
  z,
} from '@context-lake/shared-config';
import { createDbPool, createRepositoryContext } from '@context-lake/shared-db';
import { createKafkaEventPublisher } from '@context-lake/shared-events';
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

import {
  agentSessionIngestRequestSchema,
  customerIngestRequestSchema,
  idempotencyHeaderSchema,
  orderIngestRequestSchema,
  tenantHeaderSchema,
} from './contracts.js';
import { ApiError } from './errors.js';
import { IngestionMetrics } from './metrics.js';
import { OutboxRelay } from './relay.js';
import { IngestService } from './service.js';

export const ingestApiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  OUTBOX_MAX_RETRY_DELAY_SECONDS: z.coerce.number().int().positive().default(60),
  API_AUTH_TOKENS_JSON: z.string().min(2),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
});

export type IngestApiConfig = ReturnType<typeof loadIngestApiConfig>;

export function loadIngestApiConfig() {
  return loadConfig(ingestApiConfigSchema);
}

export async function createIngestApp(config = loadIngestApiConfig()) {
  const app = createHttpApp({
    serviceName: 'ingest-api',
    logLevel: config.LOG_LEVEL,
  });
  const metrics = new IngestionMetrics();
  const registry = createMetricsRegistry('ingest-api');
  const requestDurationMs = new Histogram({
    name: 'ingest_api_request_duration_ms',
    help: 'Ingest API request duration in milliseconds.',
    labelNames: ['route', 'method', 'status_code'],
    buckets: [5, 15, 50, 100, 250, 500, 1000, 3000],
    registers: [registry],
  });
  const requestTotal = new Counter({
    name: 'ingest_api_requests_total',
    help: 'Total ingest API requests.',
    labelNames: ['route', 'method', 'status_code'],
    registers: [registry],
  });
  const dbPoolConnections = new Gauge({
    name: 'ingest_api_db_pool_connections',
    help: 'Database pool connections by state.',
    labelNames: ['state'],
    registers: [registry],
  });
  const pool = createDbPool(config.POSTGRES_URL);
  const publisher = await createKafkaEventPublisher({
    clientId: 'context-lake-ingest-api',
    brokers: config.KAFKA_BROKERS.split(','),
  });
  const relay = new OutboxRelay({
    pool,
    publisher,
    logger: app.log,
    metrics,
    pollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
    batchSize: config.OUTBOX_BATCH_SIZE,
    maxRetryDelaySeconds: config.OUTBOX_MAX_RETRY_DELAY_SECONDS,
  });
  const service = new IngestService({
    pool,
    logger: app.log,
    metrics,
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

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as FastifyRequest & { contextStartedAtMs?: number }).contextStartedAtMs;
    if (!startedAt) {
      return;
    }

    const durationMs = Date.now() - startedAt;
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
    dbPoolConnections.set({ state: 'total' }, pool.totalCount);
    dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
    dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);
  });

  async function getDependencyChecks() {
    const checks = await Promise.allSettled([
      checkPostgres(config.POSTGRES_URL),
      checkRedis(config.REDIS_URL),
      checkKafka(config.KAFKA_BROKERS.split(',')),
      checkMinio({
        endPoint: config.MINIO_ENDPOINT,
        port: config.MINIO_PORT,
        useSSL: config.MINIO_USE_SSL,
        accessKey: config.MINIO_ACCESS_KEY,
        secretKey: config.MINIO_SECRET_KEY,
      }),
    ]);

    const pending = await createRepositoryContext(pool).outbox.countPending();
    metrics.setOutboxPendingCount(pending);

    return {
      postgres: checks[0].status === 'fulfilled' ? 'up' : 'down',
      redis: checks[1].status === 'fulfilled' ? 'up' : 'down',
      kafka: checks[2].status === 'fulfilled' ? 'up' : 'down',
      minio: checks[3].status === 'fulfilled' ? 'up' : 'down',
    } as const;
  }

  function getHeaders(request: FastifyRequest) {
    const idempotencyHeader = request.headers['idempotency-key'];

    if (!idempotencyHeader) {
      throw new ApiError(400, 'MISSING_IDEMPOTENCY_KEY', 'idempotency-key header is required');
    }

    return {
      tenantId: tenantHeaderSchema.parse(request.contextLake.tenantId),
      idempotencyKey: idempotencyHeaderSchema.parse(idempotencyHeader),
      actorId: request.contextLake.actorId,
    };
  }

  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks = await getDependencyChecks();
    const status: HealthStatus & { metrics: ReturnType<typeof metrics.snapshot> } = {
      status: Object.values(checks).every((value) => value === 'up') ? 'ok' : 'degraded',
      service: 'ingest-api',
      checks,
      timestamp: new Date().toISOString(),
      metrics: metrics.snapshot(),
    };

    reply.code(status.status === 'ok' ? 200 : 503);
    return status;
  });

  app.post('/ingest/customer', async (request, reply) => {
    try {
      const headers = getHeaders(request);
      const payload = customerIngestRequestSchema.parse(request.body);
      const result = await withActiveSpan(
        'ingest-api',
        'ingest.customer',
        {
          tenant_id: headers.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.ingestCustomer(payload, {
            tenantId: headers.tenantId,
            traceId: request.contextLake.traceId,
            requestId: request.contextLake.requestId,
            idempotencyKey: headers.idempotencyKey,
            actorId: headers.actorId,
            source: 'ingest-api',
          }),
      );

      reply.code(result.duplicate ? 200 : 202);
      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.post('/ingest/order', async (request, reply) => {
    try {
      const headers = getHeaders(request);
      const payload = orderIngestRequestSchema.parse(request.body);
      const result = await withActiveSpan(
        'ingest-api',
        'ingest.order',
        {
          tenant_id: headers.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.ingestOrder(payload, {
            tenantId: headers.tenantId,
            traceId: request.contextLake.traceId,
            requestId: request.contextLake.requestId,
            idempotencyKey: headers.idempotencyKey,
            actorId: headers.actorId,
            source: 'ingest-api',
          }),
      );

      reply.code(result.duplicate ? 200 : 202);
      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.post('/ingest/agent-session', async (request, reply) => {
    try {
      const headers = getHeaders(request);
      const payload = agentSessionIngestRequestSchema.parse(request.body);
      const result = await withActiveSpan(
        'ingest-api',
        'ingest.agent_session',
        {
          tenant_id: headers.tenantId,
          trace_id: request.contextLake.traceId,
        },
        () =>
          service.ingestAgentSession(payload, {
            tenantId: headers.tenantId,
            traceId: request.contextLake.traceId,
            requestId: request.contextLake.requestId,
            idempotencyKey: headers.idempotencyKey,
            actorId: headers.actorId,
            source: 'ingest-api',
          }),
      );

      reply.code(result.duplicate ? 200 : 202);
      return result;
    } catch (error) {
      return handleApiError(error, reply, request.id);
    }
  });

  app.addHook('onReady', async () => {
    relay.start();
  });

  app.addHook('onClose', async () => {
    await relay.stop();
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
