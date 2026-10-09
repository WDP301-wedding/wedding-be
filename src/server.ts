import { createServer, type RequestListener, type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Express } from 'express';
import type { Logger } from 'pino';

import { createApp, type CreateAppOptions } from './app.js';
import type { Config } from './config/config.js';
import {
  createHttpLifecycle,
  createReadinessState,
  type ReadinessState,
  type ShutdownResource,
} from './core/http/lifecycle.js';
import type { ReadinessProbe } from './core/http/readiness.js';
import { createLogger } from './core/logging/logger.js';
import { getActiveTracingResource } from './core/observability/tracing.js';
import { createIdentityRuntime } from './modules/identity-access/identity.runtime.js';
import { createVenueCatalogRuntime } from './modules/venue-catalog/venue-catalog.runtime.js';
import { createInvitationStudioRuntime } from './modules/invitation-studio/invitation-studio.runtime.js';
import { createBookingLifecycleRuntime } from './modules/booking-lifecycle/booking-lifecycle.runtime.js';

type ProcessExitCode = NodeJS.Process['exitCode'];
type ProcessSignal = 'SIGINT' | 'SIGTERM';

export interface SignalTarget {
  exitCode: ProcessExitCode;
  once(signal: ProcessSignal, listener: () => void): unknown;
  off(signal: ProcessSignal, listener: () => void): unknown;
  exit(code: number): unknown;
}

export interface RunningServer {
  readonly app: Express;
  readonly httpServer: Server;
  readonly readiness: ReadinessState;
  shutdown(): Promise<void>;
}

export interface StartServerOptions {
  readonly corsConfig?: Config['cors'];
  readonly enableOpenApiInProduction?: boolean;
  readonly port: number;
  readonly host?: string;
  readonly logger?: Logger;
  readonly metricsConfig?: Config['metrics'];
  readonly runtimeEnvironment?: Config['runtime']['environment'];
  readonly securityConfig?: Config['security'];
  readonly resources?: readonly ShutdownResource[];
  readonly shutdownTimeoutMs?: number;
  readonly readinessProbe?: ReadinessProbe;
  readonly readinessTimeoutMs?: number;
  readonly signalTarget?: SignalTarget;
  readonly createApplication?: (options: CreateAppOptions) => Express;
  readonly createHttpServer?: (requestListener: RequestListener) => Server;
  readonly reportShutdownError?: (error: unknown) => void;
  readonly registerRoutes?: CreateAppOptions['registerRoutes'];
  readonly trustedProxyHops?: 0 | 1;
}

export interface BootstrapDependencies {
  readonly loadConfig: () => Promise<Config>;
  readonly start: (config: Config) => Promise<RunningServer>;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const readiness = createReadinessState();
  const app = (options.createApplication ?? createApp)({
    ...(options.corsConfig === undefined ? {} : { corsConfig: options.corsConfig }),
    ...(options.enableOpenApiInProduction === undefined
      ? {}
      : { enableOpenApiInProduction: options.enableOpenApiInProduction }),
    readinessProbe: createServerReadinessProbe(readiness, options.readinessProbe),
    ...(options.readinessTimeoutMs === undefined
      ? {}
      : { readinessTimeoutMs: options.readinessTimeoutMs }),
    ...(options.runtimeEnvironment === undefined
      ? {}
      : { runtimeEnvironment: options.runtimeEnvironment }),
    ...(options.securityConfig === undefined ? {} : { securityConfig: options.securityConfig }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.metricsConfig === undefined ? {} : { metricsConfig: options.metricsConfig }),
    ...(options.registerRoutes === undefined ? {} : { registerRoutes: options.registerRoutes }),
    ...(options.trustedProxyHops === undefined
      ? {}
      : { trustedProxyHops: options.trustedProxyHops }),
  });
  const httpServer = (options.createHttpServer ?? createServer)(app as RequestListener);
  const lifecycle = createHttpLifecycle({
    httpServer,
    readiness,
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    ...(options.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
  });

  try {
    await listen(httpServer, options.port, options.host);
  } catch (startupError: unknown) {
    try {
      await lifecycle.shutdown();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [startupError, cleanupError],
        'The HTTP server failed to start and cleanup also failed.',
        { cause: cleanupError },
      );
    }

    throw startupError;
  }

  readiness.markReady();

  const signalTarget = options.signalTarget ?? process;
  let disposeSignalHandlers: () => void = () => undefined;
  let shutdownOperation: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    disposeSignalHandlers();
    shutdownOperation ??= lifecycle.shutdown();
    return shutdownOperation;
  };
  disposeSignalHandlers = installSignalHandlers({
    signalTarget,
    shutdown,
    reportError:
      options.reportShutdownError ??
      ((error) => {
        reportOperationalError(options.logger, 'server_shutdown_failed', error);
      }),
  });

  return Object.freeze({ app, httpServer, readiness, shutdown });
}

export async function bootstrap(
  dependencies: Partial<BootstrapDependencies> = {},
): Promise<RunningServer> {
  const loadConfig = dependencies.loadConfig ?? loadEnvironmentConfig;
  const start = dependencies.start ?? startFromConfig;
  const config = await loadConfig();

  return start(config);
}

export async function runMain(
  options: {
    readonly bootstrapDependencies?: Partial<BootstrapDependencies>;
    readonly logger?: Logger;
    readonly processRef?: Pick<SignalTarget, 'exit' | 'exitCode'>;
    readonly reportError?: (error: unknown) => void;
  } = {},
): Promise<void> {
  try {
    await bootstrap(options.bootstrapDependencies);
  } catch (error: unknown) {
    (
      options.reportError ??
      ((startupError: unknown) => {
        reportOperationalError(options.logger, 'server_startup_failed', startupError);
      })
    )(error);
    const processRef = options.processRef ?? process;
    processRef.exitCode = 1;
    processRef.exit(1);
  }
}

export function isMainModule(moduleUrl: string, entryPath = process.argv[1]): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(resolve(entryPath)).href;
}

function createServerReadinessProbe(
  readiness: ReadinessState,
  dependencyProbe: ReadinessProbe | undefined,
): ReadinessProbe {
  return async (signal) => {
    if (!readiness.isReady()) {
      throw new Error('The HTTP server lifecycle is not ready.');
    }

    await dependencyProbe?.(signal);
  };
}

function installSignalHandlers(options: {
  readonly signalTarget: SignalTarget;
  readonly shutdown: () => Promise<void>;
  readonly reportError: (error: unknown) => void;
}): () => void {
  let disposed = false;
  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    options.signalTarget.off('SIGINT', onSigint);
    options.signalTarget.off('SIGTERM', onSigterm);
  };
  const handleSignal = (): void => {
    dispose();
    void options.shutdown().then(
      () => options.signalTarget.exit(0),
      (error: unknown) => {
        try {
          options.reportError(error);
        } finally {
          options.signalTarget.exitCode = 1;
          options.signalTarget.exit(1);
        }
      },
    );
  };
  const onSigint = (): void => handleSignal();
  const onSigterm = (): void => handleSignal();

  options.signalTarget.once('SIGINT', onSigint);
  options.signalTarget.once('SIGTERM', onSigterm);

  return dispose;
}

function listen(httpServer: Server, port: number, host: string | undefined): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => {
      httpServer.off('listening', onListening);
      rejectPromise(
        error instanceof Error
          ? error
          : new Error('The HTTP server threw a non-Error value during startup.', {
              cause: error,
            }),
      );
    };
    const onListening = (): void => {
      httpServer.off('error', onError);
      resolvePromise();
    };

    httpServer.once('error', onError);
    httpServer.once('listening', onListening);

    try {
      if (host === undefined) {
        httpServer.listen(port);
      } else {
        httpServer.listen(port, host);
      }
    } catch (error: unknown) {
      httpServer.off('error', onError);
      httpServer.off('listening', onListening);
      rejectPromise(
        error instanceof Error
          ? error
          : new Error('The HTTP server threw a non-Error value during startup.', {
              cause: error,
            }),
      );
    }
  });
}

async function loadEnvironmentConfig(): Promise<Config> {
  const environmentModule = await import('./config/config.js');
  return environmentModule.config;
}

async function startFromConfig(config: Config): Promise<RunningServer> {
  const logger = createLogger({
    level: config.runtime.logLevel,
    runtimeEnvironment: config.runtime.environment,
  });

  const tracingResource = getActiveTracingResource();
  const identityRuntime = await createIdentityRuntime(config);
  let venueCatalogRuntime: Awaited<ReturnType<typeof createVenueCatalogRuntime>>;
  try {
    venueCatalogRuntime = await createVenueCatalogRuntime(config);
  } catch (error: unknown) {
    await identityRuntime.resource.close();
    throw error;
  }
  let bookingLifecycleRuntime: Awaited<ReturnType<typeof createBookingLifecycleRuntime>>;
  try {
    bookingLifecycleRuntime = await createBookingLifecycleRuntime(config);
  } catch (error: unknown) {
    await Promise.allSettled([
      identityRuntime.resource.close(),
      venueCatalogRuntime.resource.close(),
    ]);
    throw error;
  }

  let invitationStudioRuntime: Awaited<ReturnType<typeof createInvitationStudioRuntime>>;
  try {
    invitationStudioRuntime = await createInvitationStudioRuntime(config);
  } catch (error: unknown) {
    await Promise.allSettled([
      identityRuntime.resource.close(),
      venueCatalogRuntime.resource.close(),
      bookingLifecycleRuntime.resource.close(),
    ]);
    throw error;
  }

  return startServer({
    corsConfig: config.cors,
    enableOpenApiInProduction: config.openApi.enabledInProduction,
    logger,
    metricsConfig: config.metrics,
    port: config.runtime.port,
    resources:
      tracingResource === undefined
        ? [
            identityRuntime.resource,
            venueCatalogRuntime.resource,
            bookingLifecycleRuntime.resource,
            invitationStudioRuntime.resource,
          ]
        : [
            tracingResource,
            identityRuntime.resource,
            venueCatalogRuntime.resource,
            invitationStudioRuntime.resource,
            bookingLifecycleRuntime.resource,
          ],
    registerRoutes: (app) => {
      app.use('/api/v1', identityRuntime.router);
      app.use('/api/v1', venueCatalogRuntime.router);
      app.use('/api/v1', invitationStudioRuntime.router);
      app.use('/api/v1', bookingLifecycleRuntime.router);
    },
    runtimeEnvironment: config.runtime.environment,
    securityConfig: config.security,
    trustedProxyHops: config.identityAccess.trustedProxyHops,
  });
}

function reportOperationalError(
  logger: Logger | undefined,
  event: 'server_shutdown_failed' | 'server_startup_failed',
  error: unknown,
): void {
  const operationalLogger =
    logger ??
    createLogger({
      level: 'error',
      runtimeEnvironment: runtimeEnvironment(),
    });
  operationalLogger.error(
    {
      entryPoint: 'cli',
      errorName: error instanceof Error ? error.name : 'NonErrorThrownValue',
      event,
      module: 'core',
    },
    event === 'server_startup_failed' ? 'server startup failed' : 'server shutdown failed',
  );
}

function runtimeEnvironment(): Config['runtime']['environment'] {
  const value = process.env.NODE_ENV;
  return value === 'test' || value === 'staging' || value === 'production' ? value : 'development';
}

if (isMainModule(import.meta.url)) {
  void runMain();
}
