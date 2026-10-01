import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

import { errorResponseSchema } from '../http/common.schemas.js';
import { createLogger } from '../logging/logger.js';
import {
  AppError,
  InternalError,
  MalformedJsonError,
  NotFoundError,
  PayloadTooLargeError,
} from './app-error.js';

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
    response.locals.errorCode = applicationError.code;
    if (!(error instanceof AppError) && !isBodyParserError(error)) {
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

  if (isPayloadTooLargeError(error)) {
    return new PayloadTooLargeError();
  }

  return new InternalError();
}

function isBodyParserError(error: unknown): boolean {
  return isMalformedJsonError(error) || isPayloadTooLargeError(error);
}

function isMalformedJsonError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const parserError = error as SyntaxError & { status?: unknown; type?: unknown };
  return parserError.status === 400 && parserError.type === 'entity.parse.failed';
}

function isPayloadTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const parserError = error as Error & { status?: unknown; type?: unknown };
  return parserError.status === 413 && parserError.type === 'entity.too.large';
}

function defaultUnexpectedErrorReporter(error: unknown, request: Request): void {
  const requestLogger = (request as Request & { readonly log?: Logger }).log;
  const logger = requestLogger ?? fallbackErrorLogger();
  logger.error(
    {
      errorName: error instanceof Error ? error.name : 'NonErrorThrownValue',
      event: 'http_request_error',
      module: 'http',
      ...(requestLogger === undefined ? { entryPoint: 'http', requestId: request.requestId } : {}),
    },
    'unexpected request error',
  );
}

let emergencyLogger: Logger | undefined;

function fallbackErrorLogger(): Logger {
  emergencyLogger ??= createLogger({
    level: 'error',
    runtimeEnvironment: runtimeEnvironment(),
  });
  return emergencyLogger;
}

function runtimeEnvironment(): 'development' | 'test' | 'staging' | 'production' {
  const value = process.env.NODE_ENV;
  return value === 'test' || value === 'staging' || value === 'production' ? value : 'development';
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
