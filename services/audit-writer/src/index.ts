import {
  checkKafka,
  checkPostgres,
  loadConfig,
  z,
} from '@context-lake/shared-config';
import { createLogger } from '@context-lake/shared-logging';

const config = loadConfig(
  z.object({
    STARTUP_CONNECTIVITY_CHECK_INTERVAL_MS: z.coerce.number()
      .int()
      .positive()
      .default(30000),
  }),
);

const logger = createLogger('audit-writer', config.LOG_LEVEL);

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

let shuttingDown = false;
const heartbeat = setInterval(() => {
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
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

await runConnectivityChecks();

logger.info('audit writer ready');
