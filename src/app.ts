import express, { type Express } from 'express';

import type { RuntimeEnvironment } from './config/env.js';
import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorReporter,
} from './core/errors/error-handler.js';
import { createHealthRouter } from './core/http/health.router.js';
import type { ReadinessProbe } from './core/http/readiness.js';
import { createRequestContext, type IsTrustedRequestId } from './core/http/request-context.js';
import { createOpenApiRouter } from './core/openapi/openapi.router.js';

export interface CreateAppOptions {
  readonly enableOpenApiInProduction?: boolean;
  readonly isTrustedRequestId?: IsTrustedRequestId;
  readonly openApiArtifactPath?: string;
  readonly readinessProbe?: ReadinessProbe;
  readonly readinessTimeoutMs?: number;
  readonly registerRoutes?: (app: Express) => void;
  readonly reportUnexpectedError?: UnexpectedErrorReporter;
  readonly runtimeEnvironment?: RuntimeEnvironment;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(createRequestContext(options.isTrustedRequestId));
  app.use(express.json());
  app.use('/health', createHealthRouter(options));
  if (shouldServeOpenApi(options)) {
    app.use(
      '/api/v1',
      createOpenApiRouter(
        options.openApiArtifactPath === undefined
          ? {}
          : { artifactPath: options.openApiArtifactPath },
      ),
    );
  }
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.reportUnexpectedError));

  return app;
}

function shouldServeOpenApi(options: CreateAppOptions): boolean {
  return (
    (options.runtimeEnvironment ?? 'development') !== 'production' ||
    options.enableOpenApiInProduction === true
  );
}
