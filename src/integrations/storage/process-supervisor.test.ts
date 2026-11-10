import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ProcessSupervisor } from './process-supervisor.js';

function child(name: string, events: string[], exits = true) {
  const emitter = new EventEmitter();
  const result = Object.assign(emitter, {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn((signal: NodeJS.Signals) => {
      events.push(`${name}:${signal}`);
      if (exits || signal === 'SIGKILL') {
        result.signalCode = signal;
        result.emit('exit', null, signal);
      }
      return true;
    }),
  });
  return result as unknown as ChildProcess;
}
describe('co-hosted process lifecycle', () => {
  it('drains the application before MongoDB and makes repeated shutdown idempotent', async () => {
    const events: string[] = [];
    const supervisor = new ProcessSupervisor();
    supervisor.track('database', child('mongo', events));
    supervisor.track('application', child('app', events));
    expect(await Promise.all([supervisor.stop(0), supervisor.stop(0)])).toEqual([0, 0]);
    expect(events).toEqual(['app:SIGTERM', 'mongo:SIGTERM']);
    expect(await supervisor.completion).toBe(0);
    expect(supervisor.abortController.signal.aborted).toBe(true);
  });
  it('stops the API when MongoDB exits unexpectedly', async () => {
    const events: string[] = [];
    const supervisor = new ProcessSupervisor();
    const database = child('mongo', events);
    supervisor.track('database', database);
    supervisor.track('application', child('app', events));
    Object.assign(database, { exitCode: 1 });
    database.emit('exit', 1, null);
    expect(await supervisor.completion).toBe(1);
    expect(events).toEqual(['app:SIGTERM']);
  });
  it('stops MongoDB if application spawning fails and escalates a hung child', async () => {
    const events: string[] = [];
    const supervisor = new ProcessSupervisor({ application: 10, migration: 10, database: 10 });
    supervisor.track('database', child('mongo', events, false));
    const app = child('app', events);
    Object.assign(app, { pid: undefined });
    supervisor.track('application', app);
    app.emit('error', new Error('spawn failed'));
    expect(await supervisor.completion).toBe(1);
    expect(events).toEqual(['mongo:SIGTERM', 'mongo:SIGKILL']);
  });
  it('cancels an in-flight migration before database shutdown', async () => {
    const events: string[] = [];
    const supervisor = new ProcessSupervisor();
    supervisor.track('database', child('mongo', events));
    supervisor.track('migration', child('migration', events));
    await supervisor.stop(0);
    expect(events).toEqual(['migration:SIGTERM', 'mongo:SIGTERM']);
  });
});
