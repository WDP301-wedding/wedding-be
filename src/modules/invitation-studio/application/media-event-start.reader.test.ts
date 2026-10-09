import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createMediaEventStartReader,
  type MediaTimelineReader,
} from './media-event-start.reader.js';

describe('SPEC-05 approved restaurant timeline event-start consumer', () => {
  it('preserves an owner-issued transaction scope in the timeline contract context', async () => {
    const h = harness(),
      scope = randomUUID();
    await h.resolve(h.confirmed, { ...h.request, transactionScopeId: scope });
    expect(h.read).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionScopeId: scope }),
    );
    expect(JSON.stringify(h.read.mock.calls)).not.toContain('never-forward-bearer');
  });
  function harness() {
    const confirmed = {
      bookingId: randomUUID(),
      consultationId: randomUUID(),
      hallId: randomUUID(),
      shiftCode: 'DINNER' as const,
      eventDate: '2026-10-15',
      effectiveTimelineRevisionId: randomUUID(),
      planningHeadcount: 100,
    };
    const request = {
      actorId: randomUUID(),
      requestId: randomUUID(),
      accessToken: 'never-forward-bearer',
    };
    const snapshot = {
      bookingId: confirmed.bookingId,
      timelineRevisionId: confirmed.effectiveTimelineRevisionId,
      eventDate: confirmed.eventDate,
      shiftCode: confirmed.shiftCode,
      shiftStartTime: '18:25',
      approvedByManagerAt: '2026-10-01T00:00:00Z',
      approvedByCoupleAt: '2026-10-02T00:00:00Z',
      isEffective: true,
    };
    const read = vi.fn(() => Promise.resolve(snapshot));
    const reader: MediaTimelineReader = { resolveApprovedRevision: read };
    return { confirmed, request, snapshot, read, resolve: createMediaEventStartReader(reader) };
  }
  it('uses the exact approved revision/start and trusted redacted contract context', async () => {
    const h = harness();
    expect((await h.resolve(h.confirmed, h.request)).toISOString()).toBe(
      '2026-10-15T11:25:00.000Z',
    );
    expect(h.read).toHaveBeenCalledWith(
      {
        bookingId: h.confirmed.bookingId,
        timelineRevisionId: h.confirmed.effectiveTimelineRevisionId,
      },
      {
        requestId: h.request.requestId,
        causationId: h.request.requestId,
        actorAccountId: h.request.actorId,
        authority: 'AUTHENTICATED',
      },
    );
    expect(JSON.stringify(h.read.mock.calls)).not.toContain('never-forward-bearer');
  });
  it('handles leap day/midnight without using host timezone', async () => {
    const h = harness();
    h.confirmed.eventDate = '2028-02-29';
    h.read.mockResolvedValue({ ...h.snapshot, eventDate: '2028-02-29', shiftStartTime: '00:00' });
    expect((await h.resolve(h.confirmed, h.request)).toISOString()).toBe(
      '2028-02-28T17:00:00.000Z',
    );
  });
  it.each([
    { bookingId: randomUUID() },
    { timelineRevisionId: randomUUID() },
    { eventDate: '2026-10-16' },
    { shiftCode: 'LUNCH' },
    { isEffective: false },
    { approvedByManagerAt: null },
    { approvedByCoupleAt: null },
    { eventDate: '2026-02-29' },
    { shiftStartTime: '24:00' },
    { shiftStartTime: '18:99' },
    { shiftStartTime: '2026-10-15T11:00:00Z' },
  ])('rejects stale, unapproved, mismatched or malformed snapshot %j', async (change) => {
    const h = harness();
    h.read.mockImplementation(() =>
      Promise.resolve({ ...h.snapshot, ...change } as typeof h.snapshot),
    );
    await expect(h.resolve(h.confirmed, h.request)).rejects.toMatchObject({ status: 422 });
  });
  it('preserves missing/dependency failure without a fallback clock', async () => {
    const h = harness();
    await expect(
      createMediaEventStartReader(undefined)(h.confirmed, h.request),
    ).rejects.toMatchObject({ status: 503 });
    h.read.mockRejectedValue(new Error('dependency unavailable'));
    await expect(h.resolve(h.confirmed, h.request)).rejects.toThrow('dependency unavailable');
  });
});
