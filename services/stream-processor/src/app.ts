import { checkKafka, checkPostgres, checkRedis, loadConfig, z } from '@context-lake/shared-config';
import { createDbPool } from '@context-lake/shared-db';
import { createHttpApp, registerPrometheusEndpoint } from '@context-lake/shared-http';
import { createLogger } from '@context-lake/shared-logging';
import {
  Gauge,
  createMetricsRegistry,
  initializeOpenTelemetry,
  type Registry,
} from '@context-lake/shared-observability';

import { KafkaProjectionConsumer } from './consumer.js';
import { ProjectionMetrics } from './metrics.js';
import { ProjectionApplier } from './projections.js';

export const streamProcessorConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3004),
  HOST: z.string().default('0.0.0.0'),
  STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  KAFKA_CONSUMER_GROUP_ID: z.string().default('context-lake-stream-processor'),
  KAFKA_CLIENT_ID: z.string().default('context-lake-stream-processor'),
  PROJECTION_REPLAY_FROM_BEGINNING: z.coerce.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export function loadStreamProcessorConfig() {
  return loadConfig(streamProcessorConfigSchema);
}

export interface StreamProcessorRuntime {
  logger: ReturnType<typeof createLogger>;
  metrics: ProjectionMetrics;
  applier: ProjectionApplier;
  consumer: KafkaProjectionConsumer;
  adminApp: ReturnType<typeof createHttpApp>;
  registry: Registry;
  heartbeatIntervalMs: number;
  syncMetrics(): void;
  runConnectivityChecks(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createStreamProcessor(
  config = loadStreamProcessorConfig(),
): Promise<StreamProcessorRuntime> {
  const logger = createLogger('stream-processor', config.LOG_LEVEL);
  const metrics = new ProjectionMetrics();
  const pool = createDbPool(config.POSTGRES_URL);
  const registry = createMetricsRegistry('stream-processor');
  const adminApp = createHttpApp({
    serviceName: 'stream-processor',
    logLevel: config.LOG_LEVEL,
  });
  const dbPoolConnections = new Gauge({
    name: 'stream_processor_db_pool_connections',
    help: 'Stream processor DB pool connections by state.',
    labelNames: ['state'],
    registers: [registry],
  });
  const projectionLagGauge = new Gauge({
    name: 'stream_processor_consumer_lag',
    help: 'Latest estimated Kafka consumer lag.',
    registers: [registry],
  });
  const failedProjectionGauge = new Gauge({
    name: 'stream_processor_failed_projection_total',
    help: 'Total failed projection applications.',
    registers: [registry],
  });
  const projectionLatencyGauge = new Gauge({
    name: 'stream_processor_projection_update_latency_ms',
    help: 'Latest projection update latency in milliseconds.',
    registers: [registry],
  });
  const telemetry = await initializeOpenTelemetry({
    serviceName: 'stream-processor',
    endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const applier = new ProjectionApplier({
    pool,
    logger,
  });
  const consumer = new KafkaProjectionConsumer({
    brokers: config.KAFKA_BROKERS.split(','),
    groupId: config.KAFKA_CONSUMER_GROUP_ID,
    clientId: config.KAFKA_CLIENT_ID,
    topics: ['customer-events', 'order-events', 'agent-events'],
    fromBeginning: config.PROJECTION_REPLAY_FROM_BEGINNING,
    consumerName: 'stream-processor-v1',
    logger,
    metrics,
    applier,
  });

  registerPrometheusEndpoint(adminApp, registry);

  adminApp.get('/health', async (_request, reply) => {
    syncMetrics();
    const snapshot = metrics.snapshot();
    const status = {
      status: 'ok' as const,
      service: 'stream-processor',
      checks: {
        kafka: 'up' as const,
        postgres: 'up' as const,
        redis: 'up' as const,
      },
      timestamp: new Date().toISOString(),
      metrics: snapshot,
    };

    reply.code(200);
    return status;
  });

  function syncMetrics() {
    const snapshot = metrics.snapshot();
    dbPoolConnections.set({ state: 'total' }, pool.totalCount);
    dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
    dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);
    projectionLagGauge.set(snapshot.consumer_lag);
    failedProjectionGauge.set(snapshot.failed_projection_count);
    projectionLatencyGauge.set(snapshot.projection_update_latency_ms);
  }

  async function runConnectivityChecks() {
    const results = await Promise.allSettled([
      checkKafka(config.KAFKA_BROKERS.split(',')),
      checkPostgres(config.POSTGRES_URL),
      checkRedis(config.REDIS_URL),
    ]);

    logger.info(
      {
        checks: {
          kafka: results[0].status === 'fulfilled' ? 'up' : 'down',
          postgres: results[1].status === 'fulfilled' ? 'up' : 'down',
          redis: results[2].status === 'fulfilled' ? 'up' : 'down',
        },
        metrics: metrics.snapshot(),
      },
      'startup connectivity check complete',
    );
  }

  return {
    logger,
    metrics,
    applier,
    consumer,
    adminApp,
    registry,
    syncMetrics,
    runConnectivityChecks,
    async start() {
      if (config.PROJECTION_REPLAY_FROM_BEGINNING) {
        logger.warn('projection replay mode enabled from earliest offsets');
      }

      await adminApp.listen({
        port: config.PORT,
        host: config.HOST,
      });
      await consumer.start();
    },
    async stop() {
      await consumer.stop();
      await adminApp.close();
      await pool.end();
      await telemetry?.shutdown();
    },
    heartbeatIntervalMs: config.STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS,
  };
}
