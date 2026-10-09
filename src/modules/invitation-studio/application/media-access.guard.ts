import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../../core/errors/app-error.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { MediaAccessGuard, MediaRequestContext } from './media.contracts.js';

/** Consumes the exact baseline6.3 access/confirmed-context methods. A real Booking
 * owner adapter must also hold current state/access eligibility through commit. */
export interface MediaBookingReader {
  requireBookingAccess(
    this: void,
    input: { bookingId: string; accountId: string; minimum: 'FULL' },
  ): Promise<{
    readonly consultationId: string;
    readonly bookingId: string;
    readonly phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  }>;
  requireConfirmedEventContext(
    this: void,
    bookingId: string,
  ): Promise<{
    readonly consultationId: string;
    readonly bookingId: string;
    readonly hallId: string;
    readonly shiftCode: 'LUNCH' | 'DINNER';
    readonly eventDate: string;
    readonly effectiveTimelineRevisionId: string;
    readonly planningHeadcount: number;
  }>;
}

export type MediaEventStartReader = (
  context: Awaited<ReturnType<MediaBookingReader['requireConfirmedEventContext']>>,
  request: MediaRequestContext,
) => Promise<Date>;

export function createMediaAccessGuard(
  resolver: AuthenticatedActorResolver,
  booking: MediaBookingReader | undefined,
  eventStart: MediaEventStartReader | undefined,
): MediaAccessGuard {
  return {
    async requireAccess(bookingId, context) {
      if (context.accessToken === undefined) throw new NotFoundError();
      // Current resolver reads enabled account, active/non-expired/non-revoked session.
      const actor = await resolver.resolve(context.accessToken);
      if (actor.accountId !== context.actorId) throw new NotFoundError();
      const role = actor.roles.includes('MANAGER')
        ? 'MANAGER'
        : actor.roles.includes('COUPLE')
          ? 'COUPLE'
          : null;
      if (role === null) throw new NotFoundError();
      if (booking === undefined || eventStart === undefined) throw new ServiceUnavailableError();
      const access =
        role === 'COUPLE'
          ? await booking.requireBookingAccess({
              bookingId,
              accountId: actor.accountId,
              minimum: 'FULL',
            })
          : null;
      if (access !== null && (access.bookingId !== bookingId || access.phase !== 'CONFIRMED'))
        throw new NotFoundError();
      const confirmed = await booking.requireConfirmedEventContext(bookingId);
      if (
        confirmed.bookingId !== bookingId ||
        (access !== null && access.consultationId !== confirmed.consultationId)
      )
        throw new NotFoundError();
      const eventStartAt = await eventStart(confirmed, context);
      if (!Number.isFinite(eventStartAt.getTime())) throw new ValidationError();
      return { actorId: actor.accountId, role, eventStartAt };
    },
  };
}
