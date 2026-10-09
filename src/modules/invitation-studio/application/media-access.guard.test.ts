import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { createMediaAccessGuard, type MediaBookingReader } from './media-access.guard.js';

describe('SPEC-05 current Identity/Booking guard adapter', () => {
  const bookingId = randomUUID(),
    consultationId = randomUUID(),
    actorId = randomUUID();
  const context = { actorId, requestId: randomUUID(), accessToken: 'server-only-token' };
  function harness() {
    const resolver: AuthenticatedActorResolver = {
      resolve: vi.fn(() =>
        Promise.resolve({
          accountId: actorId,
          sessionId: randomUUID(),
          displayEmail: 'ignored@example.test',
          roles: ['COUPLE'] as const,
        }),
      ),
    };
    const booking: MediaBookingReader = {
      requireBookingAccess: vi.fn(() =>
        Promise.resolve({ bookingId, consultationId, phase: 'CONFIRMED' as const }),
      ),
      requireConfirmedEventContext: vi.fn(() =>
        Promise.resolve({
          bookingId,
          consultationId,
          hallId: randomUUID(),
          shiftCode: 'DINNER' as const,
          eventDate: '2026-10-15',
          effectiveTimelineRevisionId: randomUUID(),
          planningHeadcount: 100,
        }),
      ),
    };
    const calendar = vi.fn(() => Promise.resolve(new Date('2026-10-15T11:00:00Z')));
    return {
      resolver,
      booking,
      calendar,
      guard: createMediaAccessGuard(resolver, booking, calendar),
    };
  }
  it('re-resolves current identity and exact own FULL confirmed context on every call', async () => {
    const h = harness();
    expect(await h.guard.requireAccess(bookingId, context)).toMatchObject({
      actorId,
      role: 'COUPLE',
    });
    expect(h.booking.requireBookingAccess).toHaveBeenCalledWith({
      bookingId,
      accountId: actorId,
      minimum: 'FULL',
    });
    await h.guard.requireAccess(bookingId, context);
    expect(h.resolver.resolve).toHaveBeenCalledTimes(2);
    expect(h.calendar).toHaveBeenCalledWith(
      expect.objectContaining({ eventDate: '2026-10-15', shiftCode: 'DINNER' }),
      context,
    );
  });
  it('authorizes Manager confirmed context without granting Staff private access', async () => {
    const h = harness();
    vi.spyOn(h.resolver, 'resolve').mockResolvedValue({
      accountId: actorId,
      sessionId: randomUUID(),
      displayEmail: 'ignored@example.test',
      roles: ['MANAGER'],
    });
    expect((await h.guard.requireAccess(bookingId, context)).role).toBe('MANAGER');
    expect(h.booking.requireBookingAccess).not.toHaveBeenCalled();
    vi.spyOn(h.resolver, 'resolve').mockResolvedValue({
      accountId: actorId,
      sessionId: randomUUID(),
      displayEmail: 'ignored@example.test',
      roles: ['STAFF'],
    });
    await expect(h.guard.requireAccess(bookingId, context)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('fails closed when actual Booking/calendar prerequisites are absent', async () => {
    const h = harness();
    await expect(
      createMediaAccessGuard(h.resolver, undefined, h.calendar).requireAccess(bookingId, context),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      createMediaAccessGuard(h.resolver, h.booking, undefined).requireAccess(bookingId, context),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('rejects missing credentials, wrong account, non-confirmed access and mismatched consultation', async () => {
    const h = harness();
    await expect(
      h.guard.requireAccess(bookingId, { actorId, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.guard.requireAccess(bookingId, { ...context, actorId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    vi.spyOn(h.booking, 'requireBookingAccess').mockResolvedValueOnce({
      bookingId,
      consultationId,
      phase: 'AWAITING_DEPOSIT',
    });
    await expect(h.guard.requireAccess(bookingId, context)).rejects.toMatchObject({ status: 404 });
    vi.spyOn(h.booking, 'requireBookingAccess').mockResolvedValueOnce({
      bookingId,
      consultationId: randomUUID(),
      phase: 'CONFIRMED',
    });
    await expect(h.guard.requireAccess(bookingId, context)).rejects.toMatchObject({ status: 404 });
    h.calendar.mockResolvedValueOnce(new Date('invalid'));
    await expect(h.guard.requireAccess(bookingId, context)).rejects.toMatchObject({ status: 422 });
  });
});
