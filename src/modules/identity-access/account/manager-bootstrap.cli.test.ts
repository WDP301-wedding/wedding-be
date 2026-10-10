import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managerBootstrapMain } from './manager-bootstrap.cli.js';
import { runManagerBootstrap } from './manager-bootstrap.js';

vi.mock('./manager-bootstrap.js', () => ({
  runManagerBootstrap: vi.fn().mockResolvedValue(undefined),
  executeManagerBootstrap: vi.fn(),
}));
const exitCode = process.exitCode;
afterEach(() => {
  process.exitCode = exitCode;
  vi.restoreAllMocks();
});

describe('bootstrap CLI failure reporting', () => {
  it('passes operator arguments to the command without reporting a false failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(runManagerBootstrap).mockImplementationOnce(async (_args, dependencies) => {
      await dependencies.execute({
        email: 'operator@example.test',
        password: randomUUID(),
        environment: 'test',
        operatorReference: 'unit-operator',
        requestId: randomUUID(),
      });
      dependencies.write({ event: 'safe_command_result' });
    });
    await managerBootstrapMain(['--inspect-target']);
    const [args, dependencies] = vi.mocked(runManagerBootstrap).mock.calls.at(-1)!;
    expect(args).toEqual(['--inspect-target']);
    expect(typeof dependencies.readPassword).toBe('function');
    expect(typeof dependencies.execute).toBe('function');
    expect(typeof dependencies.write).toBe('function');
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('{"event":"safe_command_result"}');
  });
  it('reports only a static error and exits nonzero if credentials or database operations fail', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(runManagerBootstrap).mockRejectedValueOnce(
      new Error('password=secret-value, email=private@example.test'),
    );
    await managerBootstrapMain();
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(error.mock.calls)).toContain('manager_bootstrap_failed');
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret-value|private@example/u);
  });
});
