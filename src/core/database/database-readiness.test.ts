import { describe, expect, it, vi } from 'vitest';
import { createDatabaseReadiness } from './database-readiness.js';

function fixture(migration = { name: 'one', checksum: 'digest' }) {
  const release = vi.fn();
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        migration_name: migration.name,
        checksum: migration.checksum,
        finished_at: new Date(),
        rolled_back_at: null,
      },
    ],
  });
  const connect = vi.fn().mockResolvedValue({ query, release });
  const end = vi.fn().mockResolvedValue(undefined);
  const pool = { connect, end, on: vi.fn() };
  const runtime = createDatabaseReadiness('postgresql://user:secret@localhost/db?schema=tenant', {
    pool,
    migrations: [migration],
  });
  return { runtime, release, query, connect, end };
}

describe('database readiness resource', () => {
  it('recovers after a failed connection attempt without accepting a stale result', async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    await f.runtime.probe(signal);
    f.connect.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.runtime.probe(signal)).rejects.toThrow('database unavailable');
    await expect(f.runtime.probe(signal)).resolves.toBeUndefined();
    expect(f.connect).toHaveBeenCalledTimes(3);
    expect(f.release).toHaveBeenCalledTimes(2);
    await f.runtime.resource.close();
  });

  it('accepts only the known original Lotus checksum for the exact guarded artifact', async () => {
    const name = '20261105081000_add_lotus_layout_templates';
    const guarded = '16f8fb7b33ce8a680344bb485a772e5bcb4dc54ac6168ce2cc96f874f8b5352b';
    const original = 'b0c4d125fde2df1327ccbd7cb7af9ab3fefe8cee31ee6caca8646a0529639929';
    const signal = new AbortController().signal;
    const current = fixture({ name, checksum: guarded });
    await current.runtime.probe(signal);
    const originalRow = {
      migration_name: name,
      checksum: original,
      finished_at: new Date(),
      rolled_back_at: null,
    };
    current.query.mockResolvedValueOnce({ rows: [originalRow] });
    await current.runtime.probe(signal);

    current.query.mockResolvedValueOnce({
      rows: [{ ...originalRow, rolled_back_at: new Date() }],
    });
    await expect(current.runtime.probe(signal)).rejects.toThrow('Database schema is incompatible');

    const changed = fixture({ name, checksum: 'different-artifact' });
    changed.query.mockResolvedValueOnce({ rows: [originalRow] });
    await expect(changed.runtime.probe(signal)).rejects.toThrow('Database schema is incompatible');
  });

  it('requires the exact completed migration checksum and destroys failed connections', async () => {
    const f = fixture();
    await f.runtime.probe(new AbortController().signal);
    expect(f.release).toHaveBeenLastCalledWith(false);
    f.query.mockResolvedValueOnce({
      rows: [
        { migration_name: 'one', checksum: 'stale', finished_at: new Date(), rolled_back_at: null },
      ],
    });
    await expect(f.runtime.probe(new AbortController().signal)).rejects.toThrow(
      'Database schema is incompatible',
    );
    expect(f.release).toHaveBeenLastCalledWith(true);
    f.query.mockResolvedValueOnce({ rows: [] });
    await expect(f.runtime.probe(new AbortController().signal)).rejects.toThrow(
      'Database schema is incompatible',
    );
  });

  it('shares an in-flight query and aborts without leaking or double releasing a connection', async () => {
    const f = fixture();
    const controller = new AbortController();
    let rejectQuery!: (error: Error) => void;
    f.query.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );
    const first = f.runtime.probe(controller.signal);
    const second = f.runtime.probe(new AbortController().signal);
    await vi.waitFor(() => expect(f.query).toHaveBeenCalledOnce());
    controller.abort();
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
    rejectQuery(new Error('cancelled'));
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    await f.runtime.probe(new AbortController().signal);
    await f.runtime.resource.close();
    await f.runtime.resource.close();
    expect(f.end).toHaveBeenCalledOnce();
    await expect(f.runtime.probe(new AbortController().signal)).rejects.toThrow();
  });

  it('releases a connection acquired after an abort and refuses missing configuration', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(f.runtime.probe(controller.signal)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledWith(true);
    expect(() => createDatabaseReadiness(undefined)).toThrow();
  });
});
