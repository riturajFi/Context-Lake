import { z } from '@context-lake/shared-config';

export const tenantHeaderSchema = z.string().uuid();
export const uuidParamSchema = z.string().uuid();
export const positiveIntStringSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value));

export const contextQuerySchema = z.object({
  audit_limit: positiveIntStringSchema.optional(),
  related_limit: positiveIntStringSchema.optional(),
});

export const batchContextRequestSchema = z.object({
  items: z
    .array(
      z.object({
        entity_type: z.enum(['customer', 'order', 'agent_session']),
        entity_id: z.string().uuid(),
      }),
    )
    .min(1)
    .max(10),
  audit_limit: z.number().int().positive().max(20).optional(),
  related_limit: z.number().int().positive().max(25).optional(),
});

export type BatchContextRequest = z.infer<typeof batchContextRequestSchema>;
