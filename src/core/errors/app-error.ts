export interface ErrorDetail {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface AppErrorOptions {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export class MalformedJsonError extends AppError {
  constructor() {
    super({
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'The request body contains malformed JSON.',
    });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor() {
    super({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body is too large.',
    });
  }
}

export class RequestTimeoutError extends AppError {
  constructor() {
    super({
      status: 408,
      code: 'REQUEST_TIMEOUT',
      message: 'The request exceeded its allowed duration.',
    });
  }
}

export class CorsOriginDeniedError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'CORS_ORIGIN_DENIED',
      message: 'The request origin is not allowed.',
    });
  }
}

export class ValidationError extends AppError {
  constructor(details?: readonly ErrorDetail[]) {
    super({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super({
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
  }
}

export class ConflictError extends AppError {
  constructor() {
    super({
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    });
  }
}

export class IdempotencyKeyRequiredError extends AppError {
  constructor() {
    super({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'An Idempotency-Key header is required.',
    });
  }
}

export class InvalidIdempotencyKeyError extends AppError {
  constructor() {
    super({
      status: 422,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'The Idempotency-Key header is invalid.',
    });
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'The Idempotency-Key was already used for a different request.',
    });
  }
}

export class RequestInProgressError extends AppError {
  constructor(retryAfterSeconds: number) {
    super({
      status: 409,
      code: 'REQUEST_IN_PROGRESS',
      message: 'A request with this Idempotency-Key is still in progress.',
      headers: retryAfterHeader(retryAfterSeconds),
    });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(rateLimitOptions(retryAfterSeconds));
  }
}

export type ProviderErrorKind = 'failure' | 'unavailable' | 'timeout';

const providerErrors: Readonly<
  Record<ProviderErrorKind, Pick<AppErrorOptions, 'status' | 'code' | 'message'>>
> = {
  failure: {
    status: 502,
    code: 'PROVIDER_ERROR',
    message: 'An upstream service returned an error.',
  },
  unavailable: {
    status: 503,
    code: 'PROVIDER_UNAVAILABLE',
    message: 'An upstream service is unavailable.',
  },
  timeout: {
    status: 504,
    code: 'PROVIDER_TIMEOUT',
    message: 'An upstream service timed out.',
  },
};

export class ProviderError extends AppError {
  constructor(kind: ProviderErrorKind, cause?: unknown) {
    super({
      ...providerErrors[kind],
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The service is not ready.',
    });
  }
}

export class InternalError extends AppError {
  constructor() {
    super({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  }
}

function rateLimitOptions(retryAfterSeconds: number): AppErrorOptions {
  return {
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many requests.',
    headers: retryAfterHeader(retryAfterSeconds),
  };
}

function retryAfterHeader(retryAfterSeconds: number): Readonly<Record<string, string>> {
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds <= 0) {
    throw new RangeError('Retry-After must be a positive integer number of seconds.');
  }

  return { 'Retry-After': String(retryAfterSeconds) };
}
