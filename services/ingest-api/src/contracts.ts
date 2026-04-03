import { z } from '@context-lake/shared-config';

export const tenantHeaderSchema = z.string().uuid();
export const idempotencyHeaderSchema = z.string().min(1).max(255);

export const customerIngestRequestSchema = z.object({
  external_ref: z.string().min(1),
  email: z.string().email(),
  full_name: z.string().min(1),
  status: z.enum(['active', 'inactive']).default('active'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const orderIngestRequestSchema = z.object({
  customer_id: z.string().uuid(),
  order_number: z.string().min(1),
  status: z.enum(['pending', 'confirmed', 'cancelled']).default('pending'),
  amount_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const agentSessionIngestRequestSchema = z.object({
  customer_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  status: z.enum(['active', 'completed', 'failed']).default('active'),
  channel: z.enum(['api', 'cli', 'worker']),
  context_summary: z.record(z.string(), z.unknown()).default({}),
  started_at: z.string().datetime({ offset: true }).optional(),
  ended_at: z.string().datetime({ offset: true }).optional(),
});

export const ingestionAcceptedResponseSchema = z.object({
  request_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  resource_type: z.enum(['customer', 'order', 'agent_session']),
  event_id: z.string().uuid(),
  outbox_status: z.enum(['pending', 'processing', 'published', 'failed']),
  duplicate: z.boolean(),
  trace_id: z.string().min(1),
  tenant_id: z.string().uuid(),
});

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      'VALIDATION_ERROR',
      'MISSING_TENANT_ID',
      'MISSING_IDEMPOTENCY_KEY',
      'IDEMPOTENCY_CONFLICT',
      'NOT_FOUND',
      'INTERNAL_ERROR',
    ]),
    message: z.string(),
    trace_id: z.string().min(1),
  }),
});

export type CustomerIngestRequest = z.infer<typeof customerIngestRequestSchema>;
export type OrderIngestRequest = z.infer<typeof orderIngestRequestSchema>;
export type AgentSessionIngestRequest = z.infer<typeof agentSessionIngestRequestSchema>;
export type IngestionAcceptedResponse = z.infer<typeof ingestionAcceptedResponseSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
