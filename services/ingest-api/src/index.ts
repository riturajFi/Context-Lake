import { createIngestApp, loadIngestApiConfig } from './app.js';

const config = loadIngestApiConfig();
const app = await createIngestApp(config);

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

  app.log.info({ port: config.PORT, host: config.HOST }, 'ingest api listening');
} catch (error) {
  app.log.error({ error }, 'failed to start ingest api');
  process.exit(1);
}
