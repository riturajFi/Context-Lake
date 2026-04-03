import pino, { type DestinationStream, type Logger } from 'pino';

import type { ServiceName } from '@context-lake/shared-types';

export interface LoggerOptions {
  level?: string;
  destination?: DestinationStream;
}

export function createLogger(
  service: ServiceName,
  levelOrOptions: string | LoggerOptions = 'info',
): Logger {
  const options =
    typeof levelOrOptions === 'string' ? { level: levelOrOptions } : levelOrOptions;

  return pino(
    {
      level: options.level ?? 'info',
      redact: {
        paths: [
          'authorization',
          'req.headers.authorization',
          'req.headers.x-api-key',
          'req.headers.idempotency-key',
          'request.headers.authorization',
          'request.headers.x-api-key',
          'request.headers.idempotency-key',
          '*.authorization',
          '*.token',
          '*.secret',
          '*.password',
          '*.email',
          '*.full_name',
        ],
        censor: '[REDACTED]',
      },
      base: {
        service,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
}

export function createBufferedLogger(
  service: ServiceName,
  level = 'info',
): { logger: Logger; stream: DestinationStream } {
  const stream = pino.destination({ sync: true });
  const logger = createLogger(service, {
    level,
    destination: stream,
  });

  return {
    logger,
    stream,
  };
}
