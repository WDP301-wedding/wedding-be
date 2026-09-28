import express, { type Express } from 'express';

import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorReporter,
} from './core/errors/error-handler.js';
import { createHealthRouter } from './core/http/health.router.js';
import type { ReadinessProbe } from './core/http/readiness.js';
import { createRequestContext, type IsTrustedRequestId } from './core/http/request-context.js';

export interface CreateAppOptions {
  readonly isTrustedRequestId?: IsTrustedRequestId;
  readonly readinessProbe?: ReadinessProbe;
  readonly readinessTimeoutMs?: number;
  readonly registerRoutes?: (app: Express) => void;
  readonly reportUnexpectedError?: UnexpectedErrorReporter;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(createRequestContext(options.isTrustedRequestId));
  app.use(express.json());
  app.use('/health', createHealthRouter(options));
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.reportUnexpectedError));

  return app;
}
