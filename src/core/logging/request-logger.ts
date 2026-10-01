import { performance } from 'node:perf_hooks';

import type { Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export function createRequestLogger(logger: Logger): RequestHandler {
  const attachLogger = pinoHttp<Request, Response>({
    autoLogging: false,
    customProps(request) {
      return {
        entryPoint: 'http',
        requestId: request.requestId,
      };
    },
    genReqId(request) {
      return request.requestId;
    },
    logger,
    serializers: {
      req(request: Request) {
        return { method: request.method };
      },
    },
    wrapSerializers: false,
  });

  return (request, response, next) => {
    const startedAt = performance.now();
    let requestLogged = false;
    attachLogger(request, response);

    response.once('prefinish', () => {
      response.locals.normalizedRoute = resolveNormalizedRoute(request);
    });
    response.once('finish', () => {
      if (requestLogged) {
        return;
      }
      requestLogged = true;
      logCompletedRequest(request, response, startedAt);
    });
    response.once('close', () => {
      if (requestLogged) {
        return;
      }
      requestLogged = true;
      request.log.warn(
        requestLogFields(request, response, startedAt, 'http_request_aborted'),
        'request aborted',
      );
    });

    next();
  };
}

function logCompletedRequest(request: Request, response: Response, startedAt: number): void {
  const fields = requestLogFields(request, response, startedAt, 'http_request_completed');

  if (response.statusCode >= 500) {
    request.log.error(fields, 'request completed');
  } else if (response.statusCode >= 400) {
    request.log.warn(fields, 'request completed');
  } else {
    request.log.info(fields, 'request completed');
  }
}

function requestLogFields(
  request: Request,
  response: Response,
  startedAt: number,
  event: 'http_request_completed' | 'http_request_aborted',
): Record<string, unknown> {
  const errorCode = response.locals.errorCode as unknown;
  const capturedRoute = response.locals.normalizedRoute as unknown;

  return {
    durationMs: Number(Math.max(0, performance.now() - startedAt).toFixed(3)),
    event,
    method: request.method,
    module: 'http',
    route: typeof capturedRoute === 'string' ? capturedRoute : resolveNormalizedRoute(request),
    statusClass: `${Math.floor(response.statusCode / 100)}xx`,
    ...(typeof errorCode === 'string' ? { errorCode } : {}),
  };
}

export function resolveNormalizedRoute(request: Request): string {
  const route = request.route as { readonly path?: unknown } | undefined;
  if (typeof route?.path !== 'string') {
    return '<unmatched>';
  }

  const baseUrl = request.baseUrl.endsWith('/') ? request.baseUrl.slice(0, -1) : request.baseUrl;
  if (baseUrl === '') {
    return route.path;
  }
  if (route.path === '/') {
    return baseUrl;
  }

  return `${baseUrl}${route.path.startsWith('/') ? '' : '/'}${route.path}`;
}
