import { createHash } from 'node:crypto';

export function hashRequestBody(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function buildTraceContext(requestId: string, tenantId: string) {
  return {
    traceId: requestId,
    tenantId,
  };
}
