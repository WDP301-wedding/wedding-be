import { spawn, type ChildProcess } from 'node:child_process';

export type EmbeddedProcessRole = 'database' | 'migration' | 'application';

/** Drain HTTP/workers before terminating the database; never leave one child alone. */
export class ProcessSupervisor {
  readonly abortController = new AbortController();
  readonly completion: Promise<number>;
  private finish!: (code: number) => void;
  private readonly children = new Map<EmbeddedProcessRole, ChildProcess>();
  private stopping: Promise<number> | undefined;

  constructor(private readonly graceMs = { application: 20_000, migration: 2000, database: 5000 }) {
    this.completion = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  get isStopping(): boolean {
    return this.stopping !== undefined;
  }

  start(
    role: EmbeddedProcessRole,
    executable: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): ChildProcess {
    if (this.isStopping || this.children.has(role))
      throw new Error('Invalid supervised process state.');
    const child = spawn(executable, args, {
      env: environment,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    this.track(role, child);
    return child;
  }

  track(role: EmbeddedProcessRole, child: ChildProcess): void {
    this.children.set(role, child);
    child.once('error', () => {
      void this.stop(1);
    });
    child.once('exit', () => {
      if (role !== 'migration' && !this.isStopping) void this.stop(1);
    });
  }

  installSignalHandlers(): () => void {
    const stop = () => {
      void this.stop(0);
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return () => {
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
    };
  }

  stop(code: number): Promise<number> {
    this.stopping ??= Promise.resolve().then(async () => {
      this.abortController.abort();
      for (const role of ['application', 'migration', 'database'] as const) {
        const child = this.children.get(role);
        if (child) await terminate(child, this.graceMs[role]);
      }
      this.finish(code);
      return code;
    });
    return this.stopping;
  }
}

async function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  let timer: NodeJS.Timeout | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, graceMs);
  });
  child.kill('SIGTERM');
  await exited;
}

export function processExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
