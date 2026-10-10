import { describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../../../config/env.js';
import { runManagerBootstrap, databaseTargetFingerprint } from './manager-bootstrap.js';

const config = parseEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://rv_operator@127.0.0.1:55439/wedding_rv01_03',
});
const target = databaseTargetFingerprint(config.database.url!);
const args = [
  '--environment=test',
  '--operator=rv-local-operator',
  `--target=${target}`,
  '--email=manager@example.com',
  '--confirm-bootstrap',
];

describe('operator Manager bootstrap', () => {
  function fixture() {
    const execute = vi.fn().mockResolvedValue({ accountId: 'manager-id' });
    const readPassword = vi.fn().mockResolvedValue('unlogged-password');
    const write = vi.fn();
    return { execute, readPassword, write, config };
  }
  it('requires explicit matching environment, operator, target and confirmation before reading a secret or connecting', async () => {
    for (const invalid of [
      [],
      args.filter((a) => a !== '--confirm-bootstrap'),
      args.map((a) => (a.startsWith('--target=') ? '--target=wrong' : a)),
      args.map((a) => (a === '--environment=test' ? '--environment=production' : a)),
      [...args, '--password=leaked-secret'],
      [...args, '--operator=duplicate'],
    ]) {
      const f = fixture();
      await expect(runManagerBootstrap(invalid, f)).rejects.toThrow();
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.readPassword).not.toHaveBeenCalled();
      expect(JSON.stringify(f.write.mock.calls)).not.toContain('leaked-secret');
    }
  });
  it('passes a hidden secret to the existing service and writes only redacted success evidence', async () => {
    const f = fixture();
    await runManagerBootstrap([...args, '--password-fd=0'], f);
    expect(f.readPassword).toHaveBeenCalledWith(0);
    expect(f.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'manager@example.com',
        password: 'unlogged-password',
        operatorReference: 'rv-local-operator',
        environment: 'test',
      }),
    );
    const output = JSON.stringify(f.write.mock.calls);
    expect(output).toContain('manager_bootstrap_completed');
    expect(output).not.toMatch(/unlogged-password|manager@example|postgresql/u);
  });
  it('inspects only the credential-free target fingerprint without opening DB or prompting', async () => {
    const f = fixture();
    await runManagerBootstrap(['--inspect-target'], f);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.readPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(f.write.mock.calls)).toContain(target);
    expect(
      databaseTargetFingerprint(
        config.database.url!.replace('rv_operator@', 'rv_operator:secret@'),
      ),
    ).toBe(target);
    expect(databaseTargetFingerprint(config.database.url! + '?schema=other')).not.toBe(target);
  });
  it('does not report success when the transaction fails', async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error('secret provider failure'));
    await expect(runManagerBootstrap(args, f)).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });
});
