import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { BookingPhase } from '../domain/booking-policy.js';
import type { DepositEligibility, BookingDepositRepository } from './deposit.service.js';

export type BookingAccessContext = Readonly<{
  consultationId: string;
  bookingId: string;
  phase: BookingPhase;
}>;

export interface BookingAccessContextRepository {
  getAccessContext(bookingId: string): Promise<BookingAccessContext>;
  requireConfirmedEventContext(bookingId: string): Promise<
    Readonly<{
      consultationId: string;
      bookingId: string;
      hallId: string;
      shiftCode: 'LUNCH' | 'DINNER';
      eventDate: string;
      effectiveTimelineRevisionId: string;
      planningHeadcount: number;
    }>
  >;
}

export interface BookingLifecycleReader {
  requireBookingAccess(input: {
    bookingId: string;
    accountId: string;
    minimum: 'RESTRICTED' | 'FULL';
  }): Promise<BookingAccessContext>;
  requireDepositEligibility(input: {
    bookingId: string;
    timelineRevisionId: string;
  }): Promise<DepositEligibility>;
  requireConfirmedEventContext(
    bookingId: string,
  ): ReturnType<BookingAccessContextRepository['requireConfirmedEventContext']>;
}

export function createBookingLifecycleReader(
  options: Readonly<{
    repository: BookingAccessContextRepository;
    access: ConsultationAccessReader;
    deposits: Pick<BookingDepositRepository, 'requireDepositEligibility'>;
  }>,
): BookingLifecycleReader {
  return Object.freeze({
    async requireBookingAccess(
      input: Parameters<BookingLifecycleReader['requireBookingAccess']>[0],
    ) {
      const context = await options.repository.getAccessContext(input.bookingId);
      await options.access.requireAccess({
        accountId: input.accountId,
        consultationId: context.consultationId,
        minimum: input.minimum,
      });
      return immutable(context);
    },

    requireDepositEligibility(
      input: Parameters<BookingLifecycleReader['requireDepositEligibility']>[0],
    ) {
      return options.deposits.requireDepositEligibility(input);
    },

    requireConfirmedEventContext(bookingId: string) {
      return options.repository.requireConfirmedEventContext(bookingId);
    },
  });
}

function immutable<T>(value: T): T {
  return Object.freeze(structuredClone(value));
}
