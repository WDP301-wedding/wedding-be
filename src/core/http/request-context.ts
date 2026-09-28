import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler } from 'express';
import { z } from 'zod';

const requestIdSchema = z.uuid();

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export type IsTrustedRequestId = (request: Request, requestId: string) => boolean;

export function createRequestContext(
  isTrustedRequestId: IsTrustedRequestId = () => false,
): RequestHandler {
  return (request, response, next) => {
    const generatedRequestId = randomUUID();
    request.requestId = generatedRequestId;
    response.setHeader('x-request-id', generatedRequestId);

    const suppliedRequestId = request.get('x-request-id');
    if (
      suppliedRequestId !== undefined &&
      requestIdSchema.safeParse(suppliedRequestId).success &&
      isTrustedRequestId(request, suppliedRequestId)
    ) {
      request.requestId = suppliedRequestId;
      response.setHeader('x-request-id', suppliedRequestId);
    }

    next();
  };
}
