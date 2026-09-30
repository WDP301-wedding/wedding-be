import type { NextFunction, Response } from 'express';

import type { IdempotencyJsonValue, IdempotencyRecord } from './idempotency.repository.js';
import { canonicalizeRequest } from './request-hash.js';

export interface CapturedIdempotencyResponse {
  readonly status: number;
  readonly body: IdempotencyJsonValue | null;
}

type CompleteResponse = (captured: CapturedIdempotencyResponse) => Promise<void>;
type TransmitResponse = () => void;

export class IdempotencyResponseEncodingError extends Error {
  override readonly name = 'IdempotencyResponseEncodingError';

  constructor() {
    super('An idempotency-protected response must be JSON or have no body.');
  }
}

function isJsonContentType(value: string | number | readonly string[] | undefined): boolean {
  return typeof value === 'string' && /(?:^|\/)json(?:;|$)|\+json(?:;|$)/i.test(value);
}

function parseResponseBody(response: Response, body: unknown): IdempotencyJsonValue | null {
  if (response.statusCode === 204 || response.statusCode === 205 || body === undefined) {
    return null;
  }

  let parsed: unknown = body;

  if (Buffer.isBuffer(body)) {
    parsed = body.toString('utf8');
  }

  if (typeof parsed === 'string') {
    if (!isJsonContentType(response.getHeader('content-type'))) {
      throw new IdempotencyResponseEncodingError();
    }

    parsed = JSON.parse(parsed) as unknown;
  }

  canonicalizeRequest(parsed);
  return parsed as IdempotencyJsonValue;
}

export function captureIdempotencyResponse(
  response: Response,
  complete: CompleteResponse,
  next: NextFunction,
): void {
  const originalSend = response.send.bind(response);
  const originalEnd = response.end.bind(response) as (
    ...arguments_: readonly unknown[]
  ) => Response;
  let captured = false;

  function capture(body: unknown, transmit: TransmitResponse): Response {
    if (captured) {
      transmit();
      return response;
    }

    captured = true;

    let snapshot: CapturedIdempotencyResponse;
    try {
      snapshot = {
        status: response.statusCode,
        body: parseResponseBody(response, body),
      };
    } catch (error: unknown) {
      response.removeHeader('content-type');
      next(error);
      return response;
    }

    void complete(snapshot).then(
      () => {
        transmit();
      },
      (error: unknown) => {
        next(error);
      },
    );

    return response;
  }

  response.send = ((body?: unknown) => {
    return capture(body, () => {
      originalSend(body);
    });
  }) as Response['send'];

  response.end = ((...arguments_: readonly unknown[]) => {
    return capture(arguments_[0], () => {
      originalEnd(...arguments_);
    });
  }) as Response['end'];
}

function bodyWithRequestId(
  body: IdempotencyJsonValue | null,
  requestId: string,
): IdempotencyJsonValue | null {
  if (!isJsonObject(body)) {
    return body;
  }

  const error = body.error;
  if (!isJsonObject(error)) {
    return body;
  }

  return { ...body, error: { ...error, requestId } };
}

function isJsonObject(
  value: IdempotencyJsonValue | undefined,
): value is Readonly<{ [key: string]: IdempotencyJsonValue }> {
  return (
    value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
  );
}

export function replayIdempotencyResponse(
  response: Response,
  record: IdempotencyRecord,
  requestId: string,
): void {
  if (record.responseStatus === null) {
    throw new Error('A terminal idempotency record is missing its response status.');
  }

  response.status(record.responseStatus);

  if (
    record.responseBody === null &&
    (record.responseStatus === 204 || record.responseStatus === 205)
  ) {
    response.end();
    return;
  }

  response.json(
    record.status === 'FAILED'
      ? bodyWithRequestId(record.responseBody, requestId)
      : record.responseBody,
  );
}
