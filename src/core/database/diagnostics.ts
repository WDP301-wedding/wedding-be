import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Pool, type PoolClient } from 'pg';
import type { RequestHandler } from 'express';

export interface DatabaseDiagnostics {
  queries: number;
  errors: number;
  queryRoundTripMs: number;
  lockRoundTripMs: number;
  acquires: number;
  acquireMs: number;
  maxActive: number;
  maxIdle: number;
  maxWaiting: number;
  eventLoopDelayProcessMaxMs?: number;
}

const context = new AsyncLocalStorage<DatabaseDiagnostics>();

export function newDatabaseDiagnostics(): DatabaseDiagnostics {
  return {
    queries: 0,
    errors: 0,
    queryRoundTripMs: 0,
    lockRoundTripMs: 0,
    acquires: 0,
    acquireMs: 0,
    maxActive: 0,
    maxIdle: 0,
    maxWaiting: 0,
  };
}

export function withDatabaseDiagnostics<T>(state: DatabaseDiagnostics, work: () => T): T {
  return context.run(state, work);
}

export function databaseDiagnosticsSnapshot(): DatabaseDiagnostics | undefined {
  const state = context.getStore();
  return state ? { ...state } : undefined;
}

export function createDatabaseDiagnosticsMiddleware(enabled: boolean): RequestHandler {
  const delay = enabled ? monitorEventLoopDelay({ resolution: 20 }) : undefined;
  delay?.enable();
  return (_request, response, next) => {
    if (!enabled) return next();
    const state = newDatabaseDiagnostics();
    response.locals.databaseDiagnostics = state;
    response.once('prefinish', () => {
      // Process-wide since middleware creation, not attributed to this request.
      state.eventLoopDelayProcessMaxMs = (delay?.max ?? 0) / 1_000_000;
    });
    withDatabaseDiagnostics(state, next);
  };
}

type ConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: (error?: Error | boolean) => void,
) => void;

/** Opt-in, per-pool instrumentation. No global pg patches or SQL/parameter logs. */
export class DiagnosticPool extends Pool {
  private readonly observed = new WeakSet<PoolClient>();
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const state = context.getStore();
    const started = performance.now();
    const observe = (client?: PoolClient) => {
      if (client && !this.observed.has(client)) {
        client.query = diagnosticQuery(client.query.bind(client));
        this.observed.add(client);
      }
      if (!state) return;
      state.acquires++;
      state.acquireMs += performance.now() - started;
      state.maxActive = Math.max(state.maxActive, this.totalCount - this.idleCount);
      state.maxIdle = Math.max(state.maxIdle, this.idleCount);
      state.maxWaiting = Math.max(state.maxWaiting, this.waitingCount);
    };
    if (state) state.maxWaiting = Math.max(state.maxWaiting, this.waitingCount);
    if (callback) {
      super.connect((error, client, release) => {
        observe(client);
        // A queued pg callback can be invoked by another request's release().
        // Restore the acquiring request before pg submits its query.
        if (state) withDatabaseDiagnostics(state, () => callback(error, client, release));
        else callback(error, client, release);
      });
      if (state) state.maxWaiting = Math.max(state.maxWaiting, this.waitingCount);
      return;
    }
    const pending = super.connect();
    if (state) state.maxWaiting = Math.max(state.maxWaiting, this.waitingCount);
    return pending.then(
      (client) => {
        observe(client);
        return client;
      },
      (error) => {
        observe();
        throw error;
      },
    );
  }
}

/** Count actual pg commands, including BEGIN/COMMIT/ROLLBACK. Query time starts
 * after pool acquire and still includes network/server/lock waits. */
export function diagnosticQuery<T extends (...args: never[]) => unknown>(query: T): T {
  return new Proxy(query, {
    apply(target, receiver, args: unknown[]) {
      const state = context.getStore();
      if (!state) return Reflect.apply(target, receiver, args) as unknown;
      const started = performance.now();
      const text =
        typeof args[0] === 'string'
          ? args[0]
          : ((args[0] as { text?: string } | undefined)?.text ?? '');
      const lock = /\bFOR\s+(SHARE|UPDATE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b|\bpg_advisory_/iu.test(
        text,
      );
      state.queries++;
      let observed = false;
      const finish = (failed: boolean) => {
        if (observed) return;
        observed = true;
        if (failed) state.errors++;
        const elapsed = performance.now() - started;
        state.queryRoundTripMs += elapsed;
        if (lock) state.lockRoundTripMs += elapsed;
      };
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        args[args.length - 1] = (...values: unknown[]) => {
          finish(values[0] !== null && values[0] !== undefined);
          return Reflect.apply(callback, undefined, values) as unknown;
        };
      }
      try {
        const result: unknown = Reflect.apply(target, receiver, args);
        if (result instanceof Promise)
          return result.then(
            (value) => {
              finish(false);
              return value as unknown;
            },
            (error) => {
              finish(true);
              throw error;
            },
          );
        return result;
      } catch (error) {
        finish(true);
        throw error;
      }
    },
  });
}
