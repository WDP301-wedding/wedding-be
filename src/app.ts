import express, { type Express } from 'express';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';

import type { BackendConfig, RuntimeEnvironment } from './config/env.js';
import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorReporter,
} from './core/errors/error-handler.js';
import { createHealthRouter } from './core/http/health.router.js';
import { createGeneralRateLimit } from './core/http/rate-limit.js';
import type { ReadinessProbe } from './core/http/readiness.js';
import { createRequestContext, type IsTrustedRequestId } from './core/http/request-context.js';
import {
  createCorsMiddleware,
  createRequestDeadline,
  createSecurityHeaders,
  defaultHttpSecurityConfig,
} from './core/http/security.js';
import { createLogger } from './core/logging/logger.js';
import { createRequestLogger } from './core/logging/request-logger.js';
import {
  createHttpMetricsMiddleware,
  createObservabilityMetrics,
  type ObservabilityMetrics,
} from './core/observability/metrics.js';
import { createMetricsRouter } from './core/observability/metrics.router.js';
import { createOpenApiRouter } from './core/openapi/openapi.router.js';
import { createDocsRouter } from './core/openapi/docs.router.js';
import { createDatabaseDiagnosticsMiddleware } from './core/database/diagnostics.js';

export interface CreateAppOptions {
  readonly corsConfig?: BackendConfig['cors'];
  readonly enableOpenApiInProduction?: boolean;
  readonly isTrustedRequestId?: IsTrustedRequestId;
  readonly logger?: Logger;
  readonly metricsConfig?: BackendConfig['metrics'];
  readonly observabilityMetrics?: ObservabilityMetrics;
  readonly openApiArtifactPath?: string;
  readonly readinessProbe?: ReadinessProbe;
  readonly readinessTimeoutMs?: number;
  readonly registerRoutes?: (app: Express) => void;
  readonly registerBodyParsers?: (app: Express) => void;
  readonly reportUnexpectedError?: UnexpectedErrorReporter;
  readonly runtimeEnvironment?: RuntimeEnvironment;
  readonly securityConfig?: BackendConfig['security'];
  readonly trustedProxyHops?: 0 | 1;
  readonly databaseDiagnosticsEnabled?: boolean;
  readonly redisClient?: Redis | null;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? createDefaultLogger(options.runtimeEnvironment);
  const metrics = options.observabilityMetrics ?? createObservabilityMetrics();
  const runtimeEnvironment = options.runtimeEnvironment ?? 'development';
  const securityConfig = options.securityConfig ?? defaultHttpSecurityConfig;

  app.set('trust proxy', options.trustedProxyHops ?? 0);

  app.use(createRequestContext(options.isTrustedRequestId));
  app.use(
    createDatabaseDiagnosticsMiddleware(
      options.databaseDiagnosticsEnabled ?? process.env.DB_DIAGNOSTICS_ENABLED === 'true',
    ),
  );
  app.use(createRequestLogger(logger));
  app.use(createHttpMetricsMiddleware(metrics));
  app.use(createSecurityHeaders(runtimeEnvironment));
  app.use((request, response, next) => {
    if (request.path.startsWith('/api/v1/auth/')) {
      response.set('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(createCorsMiddleware(options.corsConfig ?? { allowedOrigins: [] }));
  app.use(createRequestDeadline(securityConfig.requestTimeoutMs));
  app.use(createGeneralRateLimit(securityConfig.rateLimit, options.redisClient));
  options.registerBodyParsers?.(app);
  app.use(express.json({ limit: securityConfig.bodyLimitBytes }));
  app.use('/health', createHealthRouter(options));
  if (options.metricsConfig?.enabled === true) {
    app.use(createMetricsRouter({ metrics, token: options.metricsConfig.token }));
  }
  if (shouldServeOpenApi(options)) {
    app.use(
      '/docs',
      createDocsRouter(
        options.openApiArtifactPath === undefined
          ? {}
          : { artifactPath: options.openApiArtifactPath },
      ),
    );
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

function createDefaultLogger(runtimeEnvironment?: RuntimeEnvironment): Logger {
  const effectiveEnvironment =
    runtimeEnvironment ?? (process.env.NODE_ENV === 'test' ? 'test' : 'development');

  return createLogger({
    level: effectiveEnvironment === 'test' ? 'silent' : 'info',
    runtimeEnvironment: effectiveEnvironment,
  });
}

function shouldServeOpenApi(options: CreateAppOptions): boolean {
  return (
    (options.runtimeEnvironment ?? 'development') !== 'production' ||
    options.enableOpenApiInProduction === true
  );
}
