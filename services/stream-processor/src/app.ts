import { checkKafka, checkPostgres, checkRedis, loadConfig, z } from '@context-lake/shared-config';
import { createDbPool } from '@context-lake/shared-db';
import { createLogger } from '@context-lake/shared-logging';

import { KafkaProjectionConsumer } from './consumer.js';
import { ProjectionMetrics } from './metrics.js';
import { ProjectionApplier } from './projections.js';

export const streamProcessorConfigSchema = z.object({
  STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  KAFKA_CONSUMER_GROUP_ID: z.string().default('context-lake-stream-processor'),
  KAFKA_CLIENT_ID: z.string().default('context-lake-stream-processor'),
  PROJECTION_REPLAY_FROM_BEGINNING: z.coerce.boolean().default(false),
});

export function loadStreamProcessorConfig() {
  return loadConfig(streamProcessorConfigSchema);
}

export interface StreamProcessorRuntime {
  logger: ReturnType<typeof createLogger>;
  metrics: ProjectionMetrics;
  applier: ProjectionApplier;
  consumer: KafkaProjectionConsumer;
  heartbeatIntervalMs: number;
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
    runConnectivityChecks,
    async start() {
      if (config.PROJECTION_REPLAY_FROM_BEGINNING) {
        logger.warn('projection replay mode enabled from earliest offsets');
      }

      await consumer.start();
    },
    async stop() {
      await consumer.stop();
      await pool.end();
    },
    heartbeatIntervalMs: config.STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS,
  };
}
