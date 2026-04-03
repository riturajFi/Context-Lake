import { randomUUID } from 'node:crypto';

import { checkKafka, checkPostgres, loadConfig, z } from '@context-lake/shared-config';
import { createDbPool, createRepositoryContext } from '@context-lake/shared-db';
import { validateEventEnvelope } from '@context-lake/shared-events';
import { createHttpApp, registerPrometheusEndpoint } from '@context-lake/shared-http';
import { createLogger } from '@context-lake/shared-logging';
import {
  Counter,
  Gauge,
  createMetricsRegistry,
  initializeOpenTelemetry,
  withActiveSpan,
} from '@context-lake/shared-observability';
import { Kafka, logLevel } from 'kafkajs';

const config = loadConfig(
  z.object({
    PORT: z.coerce.number().int().positive().default(3003),
    HOST: z.string().default('0.0.0.0'),
    STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
    KAFKA_CONSUMER_GROUP_ID: z.string().default('context-lake-audit-writer'),
    KAFKA_CLIENT_ID: z.string().default('context-lake-audit-writer'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  }),
);

const logger = createLogger('audit-writer', config.LOG_LEVEL);
const pool = createDbPool(config.POSTGRES_URL);
const registry = createMetricsRegistry('audit-writer');
const adminApp = createHttpApp({
  serviceName: 'audit-writer',
  logLevel: config.LOG_LEVEL,
});
const telemetry = await initializeOpenTelemetry({
  serviceName: 'audit-writer',
  endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKERS.split(','),
  logLevel: logLevel.NOTHING,
});
const consumer = kafka.consumer({
  groupId: config.KAFKA_CONSUMER_GROUP_ID,
});
const processedCounter = new Counter({
  name: 'audit_writer_events_processed_total',
  help: 'Total audit writer events processed by outcome.',
  labelNames: ['outcome'],
  registers: [registry],
});
const lagGauge = new Gauge({
  name: 'audit_writer_consumer_lag',
  help: 'Latest estimated audit writer lag.',
  registers: [registry],
});
const dbPoolConnections = new Gauge({
  name: 'audit_writer_db_pool_connections',
  help: 'Audit writer DB pool connections by state.',
  labelNames: ['state'],
  registers: [registry],
});

async function runConnectivityChecks() {
  const results = await Promise.allSettled([
    checkKafka(config.KAFKA_BROKERS.split(',')),
    checkPostgres(config.POSTGRES_URL),
  ]);

  logger.info(
    {
      checks: {
        kafka: results[0].status === 'fulfilled' ? 'up' : 'down',
        postgres: results[1].status === 'fulfilled' ? 'up' : 'down',
      },
    },
    'startup connectivity check complete',
  );
}

registerPrometheusEndpoint(adminApp, registry);

adminApp.get('/health', async (_request, reply) => {
  syncPoolMetrics();
  reply.code(200);
  return {
    status: 'ok',
    service: 'audit-writer',
    checks: {
      kafka: 'up',
      postgres: 'up',
    },
    timestamp: new Date().toISOString(),
  };
});

function syncPoolMetrics() {
  dbPoolConnections.set({ state: 'total' }, pool.totalCount);
  dbPoolConnections.set({ state: 'idle' }, pool.idleCount);
  dbPoolConnections.set({ state: 'waiting' }, pool.waitingCount);
}

async function refreshLag(topic: string) {
  const admin = kafka.admin();
  await admin.connect();
  const offsets = await admin.fetchTopicOffsets(topic);
  lagGauge.set(offsets.reduce((sum, offset) => sum + Number(offset.offset), 0));
  await admin.disconnect();
}

async function handleEvent(rawValue: string, topic: string) {
  const parsed = JSON.parse(rawValue) as Record<string, unknown>;
  const event = validateEventEnvelope(parsed);

  if (
    event.event_type !== 'audit.recorded' &&
    event.event_type !== 'agent.context.requested' &&
    event.event_type !== 'agent.response.generated'
  ) {
    processedCounter.inc({ outcome: 'ignored' });
    return;
  }

  await withActiveSpan(
    'audit-writer',
    `audit.${event.event_type}`,
    {
      tenant_id: event.tenant_id,
      trace_id: event.trace_id,
      request_id: event.request_id,
      topic,
    },
    async () => {
      const repositories = createRepositoryContext(pool);

      if (event.event_type === 'audit.recorded') {
        const inserted = await repositories.agentAuditLogs.insertImmutable({
          id: event.payload.audit_log_id,
          tenant_id: event.tenant_id,
          agent_session_id: event.payload.agent_session_id ?? null,
          source_event_id: event.event_id,
          request_id: event.request_id,
          service_name: event.payload.service_name,
          trace_path: event.payload.trace_path,
          event_type: event.payload.action,
          actor_id: event.actor_id ?? null,
          entity_type: event.payload.audited_entity_type,
          entity_id: event.payload.audited_entity_id,
          trace_id: event.trace_id,
          payload: {
            severity: event.payload.severity,
            message: event.payload.message,
            metadata: event.payload.metadata,
          },
          occurred_at: event.occurred_at,
        });

        processedCounter.inc({ outcome: inserted ? 'inserted' : 'duplicate' });
        return;
      }

      const inserted = await repositories.agentAuditLogs.insertImmutable({
        id: randomUUID(),
        tenant_id: event.tenant_id,
        agent_session_id: event.entity_id,
        source_event_id: event.event_id,
        request_id: event.request_id,
        service_name: event.source,
        trace_path: [
          {
            service_name: event.source,
            trace_id: event.trace_id,
            request_id: event.request_id,
            timestamp: event.produced_at,
          },
        ],
        event_type: event.event_type,
        actor_id: event.actor_id ?? null,
        entity_type: 'agent_session',
        entity_id: event.entity_id,
        trace_id: event.trace_id,
        payload: event.payload,
        occurred_at: event.occurred_at,
      });

      processedCounter.inc({ outcome: inserted ? 'inserted' : 'duplicate' });
    },
  );
}

let shuttingDown = false;
const heartbeat = setInterval(() => {
  syncPoolMetrics();
  logger.info('audit writer heartbeat');
}, config.STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS);

heartbeat.unref();

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  clearInterval(heartbeat);

  const timeout = setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);

  timeout.unref();

  try {
    await consumer.disconnect();
    await adminApp.close();
    await pool.end();
    await telemetry?.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

await runConnectivityChecks();
await adminApp.listen({
  port: config.PORT,
  host: config.HOST,
});
await consumer.connect();
await consumer.subscribe({ topic: 'audit-events', fromBeginning: false });
await consumer.subscribe({ topic: 'agent-events', fromBeginning: false });
await consumer.run({
  eachMessage: async ({ topic, message }) => {
    try {
      await handleEvent(message.value?.toString() ?? '{}', topic);
      await refreshLag(topic);
    } catch (error) {
      processedCounter.inc({ outcome: 'failed' });
      logger.error({ topic, offset: message.offset, error }, 'audit event handling failed');
    }
  },
});

logger.info('audit writer ready');
