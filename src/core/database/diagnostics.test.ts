import { describe, expect, it } from 'vitest';
import { diagnosticQuery, newDatabaseDiagnostics, withDatabaseDiagnostics } from './diagnostics.js';

describe('request database diagnostics', () => {
  it('preserves callback results, errors and synchronous exceptions', () => {
    const state = newDatabaseDiagnostics();
    withDatabaseDiagnostics(state, () => {
      const callbackQuery = diagnosticQuery(
        (text: string, callback: (error?: Error, value?: number) => void) => {
          callback(text === 'failure' ? new Error('private SQL error') : undefined, 7);
        },
      );
      callbackQuery('SELECT 1', (error, value) => {
        expect(error).toBeUndefined();
        expect(value).toBe(7);
      });
      callbackQuery('failure', (error) => {
        expect(error).toBeInstanceOf(Error);
      });
      const throwing = diagnosticQuery(() => {
        throw new Error('private failure');
      });
      expect(throwing).toThrow();
    });
    expect(state).toMatchObject({ queries: 3, errors: 2 });
    expect(JSON.stringify(state)).not.toContain('private');
  });
  it('isolates concurrent requests and counts failures without storing query text or parameters', async () => {
    const query = diagnosticQuery(async (input: { text: string; args: string[] }) => {
      await Promise.resolve();
      if (input.text === 'failure') throw new Error('secret error');
      return 1;
    });
    const first = newDatabaseDiagnostics(),
      second = newDatabaseDiagnostics();
    await Promise.all([
      withDatabaseDiagnostics(first, async () => {
        await query({ text: 'SELECT secret FOR SHARE', args: ['token'] });
        await expect(query({ text: 'failure', args: ['password'] })).rejects.toThrow();
      }),
      withDatabaseDiagnostics(second, () => query({ text: 'SELECT email', args: [] })),
    ]);
    expect(first).toMatchObject({ queries: 2, errors: 1 });
    expect(first.lockRoundTripMs).toBeGreaterThan(0);
    expect(second).toMatchObject({ queries: 1, errors: 0, lockRoundTripMs: 0 });
    expect(JSON.stringify([first, second])).not.toMatch(/secret|token|password|email/);
    await query({ text: 'outside request', args: [] });
    expect(second.queries).toBe(1);
  });
});
