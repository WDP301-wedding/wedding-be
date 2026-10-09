import { afterEach, describe, expect, it, vi } from 'vitest';
import { availabilityQuerySchema, createBookingBodySchema } from './booking-lifecycle.schemas.js';

const id = '00000000-0000-4000-8000-000000000101';
const input = {
  consultationId: id,
  hallId: id,
  eventDate: '2026-12-20',
  shiftCode: 'DINNER',
  menuPackageVersionId: id,
  tableCount: 20,
  planningHeadcount: 200,
  expectedRevision: 1,
};

describe('booking event date boundary', () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    ['2026-10-08T16:59:59Z', '2026-10-10'],
    ['2026-10-08T17:00:00Z', '2026-10-11'],
    ['2026-12-30T17:00:00Z', '2027-01-02'],
    ['2028-02-27T17:00:00Z', '2028-03-01'],
  ])('requires at least the day after tomorrow in Vietnam at %s', (now, minimum) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    expect(createBookingBodySchema.safeParse({ ...input, eventDate: minimum }).success).toBe(true);
    const tomorrow = new Date(`${minimum}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() - 1);
    for (const eventDate of [tomorrow.toISOString().slice(0, 10), '2020-01-01', '2028-02-30']) {
      const result = createBookingBodySchema.safeParse({ ...input, eventDate });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['eventDate']);
    }
  });

  it('rechecks the minimum date on each request after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:59:59Z'));
    expect(createBookingBodySchema.safeParse({ ...input, eventDate: '2026-10-10' }).success).toBe(
      true,
    );
    vi.setSystemTime(new Date('2026-10-08T17:00:00Z'));
    expect(createBookingBodySchema.safeParse({ ...input, eventDate: '2026-10-10' }).success).toBe(
      false,
    );
  });

  it('allows availability queries for historical slots without allowing a new booking', () => {
    expect(
      availabilityQuerySchema.safeParse({
        hallId: id,
        eventDate: '2020-01-01',
        shiftCode: 'DINNER',
      }).success,
    ).toBe(true);
    expect(createBookingBodySchema.safeParse({ ...input, eventDate: '2020-01-01' }).success).toBe(
      false,
    );
  });
});
