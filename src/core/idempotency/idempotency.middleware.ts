import type { RequestHandler } from 'express';

import {
  IdempotencyKeyRequiredError,
  IdempotencyKeyReusedError,
  InvalidIdempotencyKeyError,
  RequestInProgressError,
} from '../errors/app-error.js';
import {
  classifyIdempotencyResponse,
  type IdempotencyPolicy,
  readIdempotencyKey,
} from './idempotency.policy.js';
import type { IdempotencyService } from './idempotency.service.js';
import { captureIdempotencyResponse, replayIdempotencyResponse } from './response-codec.js';

export interface CreateIdempotencyMiddlewareOptions {
  readonly service: IdempotencyService;
  readonly policy: IdempotencyPolicy;
}

export function createIdempotencyMiddleware({
  service,
  policy,
}: CreateIdempotencyMiddlewareOptions): RequestHandler {
  return async (request, response, next) => {
    const header = readIdempotencyKey(request);

    if (header.outcome === 'MISSING') {
      next(new IdempotencyKeyRequiredError());
      return;
    }

    if (header.outcome === 'INVALID') {
      next(new InvalidIdempotencyKeyError());
      return;
    }

    try {
      const claim = await service.claim({
        namespace: policy.namespace(request),
        idempotencyKey: header.key,
        payload: policy.payload(request, response),
        ...(policy.retentionMs === undefined ? {} : { retentionMs: policy.retentionMs }),
      });

      switch (claim.outcome) {
        case 'MISMATCH':
          next(new IdempotencyKeyReusedError());
          return;
        case 'IN_PROGRESS':
          next(new RequestInProgressError(policy.retryAfterSeconds));
          return;
        case 'SUCCEEDED':
        case 'FAILED':
          replayIdempotencyResponse(response, claim.record, request.requestId);
          return;
        case 'CLAIMED':
          captureIdempotencyResponse(
            response,
            async ({ status, body }) => {
              const disposition = classifyIdempotencyResponse(status);

              if (disposition === 'SUCCEEDED') {
                await service.markSucceeded({
                  claimId: claim.record.id,
                  responseStatus: status,
                  responseBody: body,
                });
              } else if (disposition === 'FAILED') {
                await service.markFailed({
                  claimId: claim.record.id,
                  responseStatus: status,
                  responseBody: body,
                });
              }
            },
            next,
          );
          next();
      }
    } catch (error: unknown) {
      next(error);
    }
  };
}
