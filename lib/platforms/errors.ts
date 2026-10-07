/**
 * Typed connector errors. The sync engine decides what to do from the type,
 * never from a platform's own error codes. Messages never contain tokens.
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    readonly code: string = 'platform_error',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/** The token was rejected or expired. Stop all jobs for the connection and ask for a reconnect. */
export class AuthError extends PlatformError {
  constructor(message = 'The platform rejected the access token') {
    super(message, 'auth');
    this.name = 'AuthError';
  }
}

/** The connection lacks a permission (scope) for this request. Not retried. */
export class PermissionError extends PlatformError {
  constructor(message = 'The connection is missing a permission for this request') {
    super(message, 'permission');
    this.name = 'PermissionError';
  }
}

/** The platform asked us to slow down. Resume after `retryAfterSeconds`. */
export class RateLimitError extends PlatformError {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Rate limited by the platform',
  ) {
    super(message, 'rate_limited');
    this.name = 'RateLimitError';
  }
}

/** The response did not match the expected shape. Not retried; logged with a sample. */
export class ValidationError extends PlatformError {
  constructor(message: string) {
    super(message, 'invalid_response');
    this.name = 'ValidationError';
  }
}

/** Network failure or 5xx after all retries. */
export class TransientError extends PlatformError {
  constructor(message: string, status?: number) {
    super(message, 'transient', status);
    this.name = 'TransientError';
  }
}
