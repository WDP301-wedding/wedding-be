import { describe, expect, it, vi } from 'vitest';
import { createDatabaseReadiness } from './database-readiness.js';

function fixture() {
  const release = vi.fn();
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        migration_name: 'one',
        checksum: 'digest',
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
    migrations: [{ name: 'one', checksum: 'digest' }],
  });
  return { runtime, release, query, connect, end };
}

describe('database readiness resource', () => {
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
