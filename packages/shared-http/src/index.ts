import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { createLogger } from '@context-lake/shared-logging';
import type { ServiceName } from '@context-lake/shared-types';

export interface HttpAppOptions {
  serviceName: ServiceName;
  logLevel?: string;
}

export function createHttpApp({
  serviceName,
  logLevel,
}: HttpAppOptions): FastifyInstance {
  const logger = createLogger(serviceName, logLevel) as FastifyBaseLogger;
  const app = Fastify({
    logger,
    requestIdHeader: 'x-request-id',
    genReqId(request) {
      return request.headers['x-request-id']?.toString() ?? crypto.randomUUID();
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  return app;
}
