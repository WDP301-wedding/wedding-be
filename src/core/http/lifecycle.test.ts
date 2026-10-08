import { createServer, Server } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { parseEnvironment } from '../../config/env.js';
import { bootstrap, isMainModule, runMain, startServer, type RunningServer } from '../../server.js';
import { createVenueCatalogRuntime } from '../../modules/venue-catalog/venue-catalog.runtime.js';
import { createLogger } from '../logging/logger.js';
import {
  createHttpLifecycle,
  createReadinessState,
  ShutdownTimeoutError,
  type ShutdownResource,
} from './lifecycle.js';

vi.mock('../../modules/identity-access/identity.runtime.js', async () => {
  const { Router } = await import('express');

  return {
    createIdentityRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'identity-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../modules/venue-catalog/venue-catalog.runtime.js', async () => {
  const { Router } = await import('express');

  return {
    createVenueCatalogRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'venue-catalog-database', close: vi.fn() },
    })),
  };
});

vi.mock('../../modules/booking-lifecycle/booking-lifecycle.runtime.js', async () => {
  const { Router } = await import('express');
  return {
    createBookingLifecycleRuntime: vi.fn(() => ({
      router: Router(),
      resource: { name: 'booking-lifecycle-database', close: vi.fn() },
    })),
  };
});

class TestSignalTarget extends EventEmitter {
  exitCode: NodeJS.Process['exitCode'];
  exitedWith: number | undefined;

  exit(code: number): void {
    this.exitedWith = code;
  }
}

const runningServers: RunningServer[] = [];

afterEach(async () => {
  await Promise.allSettled(runningServers.splice(0).map((server) => server.shutdown()));
  vi.restoreAllMocks();
});

describe('Express application composition', () => {
  it('creates a testable application without opening a listening port', () => {
    const listen = vi.spyOn(Server.prototype, 'listen');

    const app = createApp();

    expect(typeof app).toBe('function');
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('readiness state', () => {
  it('starts unready and follows explicit lifecycle transitions', () => {
    const readiness = createReadinessState();

    expect(readiness.isReady()).toBe(false);
    readiness.markReady();
    expect(readiness.isReady()).toBe(true);
    readiness.markNotReady();
    expect(readiness.isReady()).toBe(false);
  });
});

describe('HTTP lifecycle', () => {
  it('closes resources once and returns the same shutdown operation to every caller', async () => {
    const close = vi.fn();
    const resource: ShutdownResource = {
      name: 'test-resource',
      close,
    };
    const readiness = createReadinessState();
    readiness.markReady();
    const httpServer = createServer();
    const lifecycle = createHttpLifecycle({
      httpServer,
      readiness,
      resources: [resource],
      shutdownTimeoutMs: 100,
    });

    const firstShutdown = lifecycle.shutdown();
    const secondShutdown = lifecycle.shutdown();

    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    expect(readiness.isReady()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports every graceful cleanup failure after attempting all resources', async () => {
    const firstError = new Error('first close failed');
    const secondError = new Error('second close failed');
    const closeFirst = vi.fn().mockRejectedValue(firstError);
    const closeSecond = vi.fn().mockRejectedValue(secondError);
    const forceCloseFirst = vi.fn();
    const forceCloseSecond = vi.fn();
    const firstResource: ShutdownResource = {
      name: 'first-resource',
      close: closeFirst,
      forceClose: forceCloseFirst,
    };
    const secondResource: ShutdownResource = {
      name: 'second-resource',
      close: closeSecond,
      forceClose: forceCloseSecond,
    };
    const lifecycle = createHttpLifecycle({
      httpServer: createServer(),
      readiness: createReadinessState(),
      resources: [firstResource, secondResource],
      shutdownTimeoutMs: 100,
    });

    await expect(lifecycle.shutdown()).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [firstError, secondError],
    });
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
    expect(forceCloseFirst).toHaveBeenCalledOnce();
    expect(forceCloseSecond).toHaveBeenCalledOnce();
  });

  it('forces HTTP and resource cleanup when the deadline expires', async () => {
    const neverCloses = new Promise<void>(() => undefined);
    const forceClose = vi.fn();
    const resource: ShutdownResource = {
      name: 'stalled-resource',
      close: vi.fn(() => neverCloses),
      forceClose,
    };
    const httpServer = createServer();
    const closeAllConnections = vi.spyOn(httpServer, 'closeAllConnections');
    const lifecycle = createHttpLifecycle({
      httpServer,
      readiness: createReadinessState(),
      resources: [resource],
      shutdownTimeoutMs: 10,
    });

    await expect(lifecycle.shutdown()).rejects.toBeInstanceOf(ShutdownTimeoutError);
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(forceClose).toHaveBeenCalledOnce();
  });

  it('rejects a non-positive shutdown deadline before cleanup starts', () => {
    expect(() =>
      createHttpLifecycle({
        httpServer: createServer(),
        readiness: createReadinessState(),
        shutdownTimeoutMs: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe('server startup and process signals', () => {
  it('listens, becomes ready, and removes signal listeners during clean shutdown', async () => {
    const signalTarget = new TestSignalTarget();
    const closeResource = vi.fn();
    const running = await startServer({
      port: 0,
      resources: [{ name: 'resource', close: closeResource }],
      shutdownTimeoutMs: 100,
      signalTarget,
    });
    runningServers.push(running);

    expect(running.httpServer.listening).toBe(true);
    expect(running.readiness.isReady()).toBe(true);
    expect(signalTarget.listenerCount('SIGINT')).toBe(1);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(1);

    signalTarget.emit('SIGTERM');
    await running.shutdown();

    expect(running.httpServer.listening).toBe(false);
    expect(running.readiness.isReady()).toBe(false);
    expect(closeResource).toHaveBeenCalledOnce();
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    expect(signalTarget.exitedWith).toBe(0);
  });

  it('cleans resources and rejects when the HTTP port cannot be opened', async () => {
    const blockingServer = createServer();
    blockingServer.listen(0, '127.0.0.1');
    await once(blockingServer, 'listening');
    const address = blockingServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP listener address.');
    }
    const closeResource = vi.fn();

    try {
      await expect(
        startServer({
          host: '127.0.0.1',
          port: address.port,
          resources: [{ name: 'resource', close: closeResource }],
          signalTarget: new TestSignalTarget(),
        }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(closeResource).toHaveBeenCalledOnce();
    } finally {
      blockingServer.close();
      await once(blockingServer, 'close');
    }
  });

  it('does not attempt to start when configuration loading fails', async () => {
    const configurationError = new Error('invalid configuration');
    const start = vi.fn<(config: ReturnType<typeof parseEnvironment>) => Promise<RunningServer>>();

    await expect(
      bootstrap({
        loadConfig: vi.fn().mockRejectedValue(configurationError),
        start,
      }),
    ).rejects.toBe(configurationError);
    expect(start).not.toHaveBeenCalled();
  });

  it('passes validated configuration to startup', async () => {
    const config = parseEnvironment({ PORT: '3456' });
    const expected = { marker: 'running' } as unknown as RunningServer;
    const start = vi.fn().mockResolvedValue(expected);

    await expect(
      bootstrap({
        loadConfig: vi.fn().mockResolvedValue(config),
        start,
      }),
    ).resolves.toBe(expected);
    expect(start).toHaveBeenCalledWith(config);
  });

  it('loads the environment boundary before invoking an injected startup', async () => {
    const expected = { marker: 'running' } as unknown as RunningServer;
    const start = vi
      .fn<(config: ReturnType<typeof parseEnvironment>) => Promise<RunningServer>>()
      .mockResolvedValue(expected);

    await expect(bootstrap({ start })).resolves.toBe(expected);
    expect(start.mock.calls[0]?.[0].runtime.environment).toBe('test');
  });

  it('uses the validated port for the default server startup', async () => {
    const baseConfig = parseEnvironment({});
    const config = {
      ...baseConfig,
      runtime: { ...baseConfig.runtime, port: 0 },
    } as ReturnType<typeof parseEnvironment>;

    const running = await bootstrap({
      loadConfig: vi.fn().mockResolvedValue(config),
    });
    runningServers.push(running);

    expect(createVenueCatalogRuntime).toHaveBeenCalledWith(config);
    expect(running.httpServer.listening).toBe(true);
    expect(running.readiness.isReady()).toBe(true);
  });

  it('reports signal-triggered shutdown failures and sets a failing exit code', async () => {
    const signalTarget = new TestSignalTarget();
    const reportShutdownError = vi.fn();
    const neverCloses = new Promise<void>(() => undefined);
    const running = await startServer({
      port: 0,
      resources: [{ name: 'stalled-resource', close: () => neverCloses }],
      shutdownTimeoutMs: 10,
      signalTarget,
      reportShutdownError,
    });
    runningServers.push(running);

    signalTarget.emit('SIGINT');
    await expect(running.shutdown()).rejects.toBeInstanceOf(ShutdownTimeoutError);
    await vi.waitFor(() => expect(reportShutdownError).toHaveBeenCalledOnce());

    expect(signalTarget.exitCode).toBe(1);
    expect(signalTarget.exitedWith).toBe(1);
  });

  it('sets a failing process exit code when executable startup fails', async () => {
    const signalTarget = new TestSignalTarget();
    const reportError = vi.fn();
    const startupError = new Error('startup failed');

    await runMain({
      bootstrapDependencies: {
        loadConfig: vi.fn().mockRejectedValue(startupError),
      },
      processRef: signalTarget,
      reportError,
    });

    expect(reportError).toHaveBeenCalledWith(startupError);
    expect(signalTarget.exitCode).toBe(1);
    expect(signalTarget.exitedWith).toBe(1);
  });

  it('writes a structured startup failure through the supplied operational logger', async () => {
    const signalTarget = new TestSignalTarget();
    const logLines: string[] = [];
    const logger = createLogger({
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logLines.push(String(chunk));
          callback();
        },
      }),
      level: 'error',
      runtimeEnvironment: 'test',
    });

    await runMain({
      bootstrapDependencies: {
        loadConfig: vi.fn().mockRejectedValue('configuration unavailable'),
      },
      logger,
      processRef: signalTarget,
    });

    expect(logLines.join('')).toContain('"event":"server_startup_failed"');
    expect(logLines.join('')).toContain('"errorName":"NonErrorThrownValue"');
    expect(signalTarget.exitedWith).toBe(1);
  });

  it('writes a structured shutdown failure through the server logger', async () => {
    const signalTarget = new TestSignalTarget();
    const logLines: string[] = [];
    const logger = createLogger({
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logLines.push(String(chunk));
          callback();
        },
      }),
      level: 'error',
      runtimeEnvironment: 'test',
    });
    const neverCloses = new Promise<void>(() => undefined);
    const running = await startServer({
      logger,
      port: 0,
      resources: [{ name: 'stalled-resource', close: () => neverCloses }],
      shutdownTimeoutMs: 10,
      signalTarget,
    });
    runningServers.push(running);

    signalTarget.emit('SIGTERM');
    await expect(running.shutdown()).rejects.toBeInstanceOf(ShutdownTimeoutError);
    await vi.waitFor(() => expect(logLines.join('')).toContain('"event":"server_shutdown_failed"'));

    expect(logLines.join('')).toContain('"errorName":"ShutdownTimeoutError"');
    expect(signalTarget.exitedWith).toBe(1);
  });

  it('normalizes the executable path when detecting direct module execution', () => {
    const entryPath = resolve('dist/server.js');

    expect(isMainModule(pathToFileURL(entryPath).href, entryPath)).toBe(true);
    expect(isMainModule('file:///different/server.js', entryPath)).toBe(false);
    expect(isMainModule(pathToFileURL(entryPath).href, undefined)).toBe(false);
  });
});
