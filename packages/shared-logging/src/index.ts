import pino from 'pino';

import type { ServiceName } from '@context-lake/shared-types';

export function createLogger(service: ServiceName, level = 'info') {
  return pino({
    level,
    base: {
      service,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
