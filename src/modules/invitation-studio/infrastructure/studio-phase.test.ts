import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../core/logging/logger.js';
import { ProviderError } from '../../../core/errors/app-error.js';
import { studioPhase, studioErrorKind } from './studio-phase.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../../core/database/diagnostics.js';

describe('Invitation stage diagnostics', () => {
  it('attaches phase database deltas when diagnostics are enabled, without logging SQL', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      runtimeEnvironment: 'test',
      level: 'info',
      destination: {
        write: (line) => {
          lines.push(line);
        },
      },
    });
    const database = newDatabaseDiagnostics();
    await withDatabaseDiagnostics(database, () =>
      studioPhase({ actorId: 'private', requestId: 'r', logger }, 'print.list', 'read', () => {
        database.queries += 2;
        database.acquires++;
        database.acquireMs += 3;
        database.queryRoundTripMs += 5;
        return Promise.resolve();
      }),
    );
    expect(JSON.parse(lines[0]!) as unknown).toMatchObject({
      database: { queries: 2, acquires: 1, acquireMs: 3, queryRoundTripMs: 5 },
    });
    await expect(
      studioPhase({ actorId: 'a', requestId: 'r' }, 'asset.derive', 'acceptance', () =>
        Promise.reject(Object.assign(new Error('transaction cancelled'), { code: 'P2028' })),
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
  it('distinguishes database admission, transactions, provider timeout and unknown errors', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      runtimeEnvironment: 'test',
      level: 'info',
      destination: {
        write: (line) => {
          lines.push(line);
        },
      },
    });
    const context = {
      actorId: 'private-actor',
      accessToken: 'private-bearer',
      requestId: 'request-1',
      logger,
    };
    await expect(
      studioPhase(context, 'ai.generate', 'claim', () =>
        Promise.reject(new Error('timeout exceeded when trying to connect')),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    await expect(
      studioPhase(context, 'ai.generate', 'provider', () =>
        Promise.reject(new ProviderError('timeout')),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(
      await studioPhase(context, 'ai.generate', 'decode', () => Promise.resolve('private-image')),
    ).toBe('private-image');
    expect(studioErrorKind({ code: 'P2028', message: 'sensitive sql' })).toBe(
      'database_transaction',
    );
    expect(studioErrorKind(new Error('private provider prompt'))).toBe('unexpected');
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.map((event) => event.phase)).toEqual(['claim', 'provider', 'decode']);
    expect(events[0]).toMatchObject({
      requestId: 'request-1',
      outcome: 'error',
      errorKind: 'database_acquisition',
    });
    expect(events[1]).toMatchObject({ errorKind: 'PROVIDER_TIMEOUT' });
    expect(events[2]).toMatchObject({ outcome: 'success', operation: 'ai.generate' });
    for (const text of [
      'private-actor',
      'private-bearer',
      'private-image',
      'sensitive sql',
      'private provider prompt',
    ])
      expect(lines.join('')).not.toContain(text);
  });
});
