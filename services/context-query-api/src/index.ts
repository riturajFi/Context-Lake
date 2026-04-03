import {
  checkMinio,
  checkPostgres,
  checkRedis,
  loadConfig,
  z,
} from '@context-lake/shared-config';
import { createHttpApp } from '@context-lake/shared-http';
import type { HealthStatus } from '@context-lake/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';

const config = loadConfig(
  z.object({
    PORT: z.coerce.number().int().positive().default(3002),
    HOST: z.string().default('0.0.0.0'),
  }),
);

const app = createHttpApp({
  serviceName: 'context-query-api',
  logLevel: config.LOG_LEVEL,
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

  return {
    postgres: checks[0].status === 'fulfilled' ? 'up' : 'down',
    redis: checks[1].status === 'fulfilled' ? 'up' : 'down',
    minio: checks[2].status === 'fulfilled' ? 'up' : 'down',
  } as const;
}

app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
  const checks = await getDependencyChecks();
  const status: HealthStatus = {
    status: Object.values(checks).every((value) => value === 'up') ? 'ok' : 'degraded',
    service: 'context-query-api',
    checks,
    timestamp: new Date().toISOString(),
  };

  reply.code(status.status === 'ok' ? 200 : 503);
  return status;
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');

  const timeout = setTimeout(() => {
    app.log.error('forced shutdown after timeout');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);

  timeout.unref();

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, 'shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({
    port: config.PORT,
    host: config.HOST,
  });

  app.log.info({ port: config.PORT, host: config.HOST }, 'context query api listening');
} catch (error) {
  app.log.error({ error }, 'failed to start context query api');
  process.exit(1);
}
