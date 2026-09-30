import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

import { errorResponseSchema } from '../http/common.schemas.js';
import { AppError, InternalError, MalformedJsonError, NotFoundError } from './app-error.js';

export type UnexpectedErrorReporter = (error: unknown, request: Request) => void;

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new NotFoundError());
};

export function createErrorHandler(
  reportUnexpectedError: UnexpectedErrorReporter = defaultUnexpectedErrorReporter,
): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const applicationError = normalizeError(error);
    if (!(error instanceof AppError) && !isMalformedJsonError(error)) {
      safelyReportUnexpectedError(reportUnexpectedError, error, request);
    }

    if (applicationError.headers !== undefined) {
      response.set(applicationError.headers);
    }

    const body = errorResponseSchema.parse({
      error: {
        code: applicationError.code,
        message: applicationError.message,
        ...(applicationError.details === undefined ? {} : { details: applicationError.details }),
        requestId: request.requestId,
      },
    });
    response.status(applicationError.status).json(body);
  };
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (isMalformedJsonError(error)) {
    return new MalformedJsonError();
  }

  return new InternalError();
}

function isMalformedJsonError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const parserError = error as SyntaxError & { status?: unknown; type?: unknown };
  return parserError.status === 400 && parserError.type === 'entity.parse.failed';
}

function defaultUnexpectedErrorReporter(error: unknown, request: Request): void {
  console.error('Unexpected request error.', {
    requestId: request.requestId,
    errorName: error instanceof Error ? error.name : 'NonErrorThrownValue',
  });
}

function safelyReportUnexpectedError(
  reporter: UnexpectedErrorReporter,
  error: unknown,
  request: Request,
): void {
  try {
    reporter(error, request);
  } catch (reportingError: unknown) {
    defaultUnexpectedErrorReporter(reportingError, request);
  }
}
