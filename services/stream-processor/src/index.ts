import { createStreamProcessor, loadStreamProcessorConfig } from './app.js';

const config = loadStreamProcessorConfig();
const processor = await createStreamProcessor(config);

let shuttingDown = false;
const heartbeat = setInterval(() => {
  processor.logger.info({ metrics: processor.metrics.snapshot() }, 'stream processor heartbeat');
}, processor.heartbeatIntervalMs);

heartbeat.unref();

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  processor.logger.info({ signal }, 'shutting down');
  clearInterval(heartbeat);

  const timeout = setTimeout(() => {
    processor.logger.error('forced shutdown after timeout');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);

  timeout.unref();

  try {
    await processor.stop();
    process.exit(0);
  } catch (error) {
    processor.logger.error({ error }, 'shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

await processor.runConnectivityChecks();
await processor.start();
processor.logger.info('stream processor ready');
