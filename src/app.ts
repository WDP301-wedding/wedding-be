import express, { type Express } from 'express';

import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorReporter,
} from './core/errors/error-handler.js';
import { createRequestContext, type IsTrustedRequestId } from './core/http/request-context.js';

export interface CreateAppOptions {
  readonly isTrustedRequestId?: IsTrustedRequestId;
  readonly registerRoutes?: (app: Express) => void;
  readonly reportUnexpectedError?: UnexpectedErrorReporter;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(createRequestContext(options.isTrustedRequestId));
  app.use(express.json());
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.reportUnexpectedError));

  return app;
}
