export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'MISSING_TENANT_ID'
      | 'MISSING_IDEMPOTENCY_KEY'
      | 'AUTH_REQUIRED'
      | 'AUTH_INVALID'
      | 'TENANT_FORBIDDEN'
      | 'RATE_LIMITED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'NOT_FOUND'
      | 'INTERNAL_ERROR',
    message: string,
  ) {
    super(message);
  }
}
