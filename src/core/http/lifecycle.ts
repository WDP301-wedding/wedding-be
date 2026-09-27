import type { Server } from 'node:http';

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ReadinessState {
  isReady(): boolean;
  markReady(): void;
  markNotReady(): void;
}

export interface ShutdownResource {
  readonly name: string;
  close(): Promise<void> | void;
  forceClose?(): void;
}

export interface HttpLifecycle {
  shutdown(): Promise<void>;
}

export class ShutdownTimeoutError extends Error {
  override readonly name = 'ShutdownTimeoutError';

  constructor(readonly timeoutMs: number) {
    super(`Graceful shutdown exceeded ${timeoutMs}ms.`);
  }
}

export function createReadinessState(): ReadinessState {
  let ready = false;

  return Object.freeze({
    isReady: () => ready,
    markReady: () => {
      ready = true;
    },
    markNotReady: () => {
      ready = false;
    },
  });
}

export function createHttpLifecycle(options: {
  readonly httpServer: Server;
  readonly readiness: ReadinessState;
  readonly resources?: readonly ShutdownResource[];
  readonly shutdownTimeoutMs?: number;
}): HttpLifecycle {
  const resources = options.resources ?? [];
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new RangeError('The shutdown timeout must be a positive finite number.');
  }

  let shutdownOperation: Promise<void> | undefined;

  return Object.freeze({
    shutdown: () => {
      shutdownOperation ??= beginShutdown(
        options.httpServer,
        options.readiness,
        resources,
        shutdownTimeoutMs,
      );

      return shutdownOperation;
    },
  });
}

async function beginShutdown(
  httpServer: Server,
  readiness: ReadinessState,
  resources: readonly ShutdownResource[],
  shutdownTimeoutMs: number,
): Promise<void> {
  readiness.markNotReady();

  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new ShutdownTimeoutError(shutdownTimeoutMs));
    }, shutdownTimeoutMs);
  });

  try {
    await Promise.race([closeGracefully(httpServer, resources), deadline]);
  } catch (error: unknown) {
    forceCleanup(httpServer, resources);
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function closeGracefully(
  httpServer: Server,
  resources: readonly ShutdownResource[],
): Promise<void> {
  const failures: unknown[] = [];

  try {
    await closeHttpServer(httpServer);
  } catch (error: unknown) {
    failures.push(error);
  }

  const resourceResults = await Promise.allSettled(
    resources.map(async (resource) => resource.close()),
  );

  for (const result of resourceResults) {
    if (result.status === 'rejected') {
      failures.push(result.reason);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more graceful shutdown operations failed.');
  }
}

function closeHttpServer(httpServer: Server): Promise<void> {
  if (!httpServer.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function forceCleanup(httpServer: Server, resources: readonly ShutdownResource[]): void {
  tryBestEffort(() => httpServer.closeAllConnections());

  for (const resource of resources) {
    if (resource.forceClose !== undefined) {
      tryBestEffort(() => resource.forceClose?.());
    }
  }
}

function tryBestEffort(operation: () => void): void {
  try {
    operation();
  } catch {
    // The deadline has already expired; continue forcing the remaining resources closed.
  }
}
