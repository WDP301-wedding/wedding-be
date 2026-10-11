import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createEventEndReader } from './event-end.reader.js';
const booking = {
  phase: 'CONFIRMED',
  eventDate: new Date('2026-10-11T00:00:00Z'),
  proposalSnapshot: { shiftEndTime: new Date('1970-01-01T22:00:00Z') },
};
function reader(row: typeof booking | null, now: string | null) {
  return createEventEndReader({
    booking: { findUnique: vi.fn().mockResolvedValue(row) },
    $queryRaw: vi.fn().mockResolvedValue(now ? [{ now: new Date(now) }] : []),
  } as unknown as PrismaClient);
}
it('uses Vietnam event time at the exact end boundary without waiting for the completion job', async () => {
  const id = randomUUID();
  await expect(reader(booking, '2026-10-11T14:59:59.999Z').requireEnded(id)).rejects.toMatchObject({
    code: 'EVENT_NOT_ENDED',
  });
  for (const now of ['2026-10-11T15:00:00.000Z', '2026-10-11T15:00:00.001Z'])
    expect(await reader(booking, now).requireEnded(id)).toEqual({
      bookingId: id,
      phase: 'CONFIRMED',
      eventEndAt: '2026-10-11T15:00:00.000Z',
    });
});
it('denies cancelled, unconfirmed, absent and unverifiable event sources', async () => {
  const id = randomUUID();
  await expect(reader(null, null).requireEnded(id)).rejects.toMatchObject({ status: 404 });
  for (const phase of ['CANCELLED', 'DRAFT', 'AWAITING_DEPOSIT'])
    await expect(reader({ ...booking, phase }, null).requireEnded(id)).rejects.toMatchObject({
      code: 'INVOICE_NOT_ELIGIBLE',
    });
  await expect(
    reader({ ...booking, proposalSnapshot: null } as unknown as typeof booking, null).requireEnded(
      id,
    ),
  ).rejects.toMatchObject({ code: 'INVOICE_NOT_ELIGIBLE' });
  await expect(reader(booking, null).requireEnded(id)).rejects.toMatchObject({
    code: 'EVENT_NOT_ENDED',
  });
  expect(
    (await reader({ ...booking, phase: 'COMPLETED' }, '2026-10-12T00:00:00Z').requireEnded(id))
      .phase,
  ).toBe('COMPLETED');
});
