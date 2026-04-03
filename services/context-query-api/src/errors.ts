export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'MISSING_TENANT_ID'
      | 'AUTH_REQUIRED'
      | 'AUTH_INVALID'
      | 'TENANT_FORBIDDEN'
      | 'RATE_LIMITED'
      | 'NOT_FOUND'
      | 'AUDIT_UNAVAILABLE'
      | 'INTERNAL_ERROR',
    message: string,
  ) {
    super(message);
  }
}
