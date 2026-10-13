import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PublicInvitation } from '../../invitation-studio/domain/public-invitation.js';
import type {
  BookingMediaPrerequisiteReader,
  BookingTimelineSnapshotReader,
} from '../../booking-lifecycle/application/booking-readers.js';

export type GuestRequestContext = Readonly<{
  actorId: string;
  accessToken: string;
  requestId: string;
}>;
export interface GuestInvitationReader {
  getCurrent(bookingId: string, publicInvitationId?: string): Promise<PublicInvitation>;
}
export interface GuestBookingPlanningPort {
  requireInvitationViewContext(bookingId: string): Promise<void>;
  getSource(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      bookingRevision: number;
      planningHeadcount: number;
      sourceSequence: number;
      sourceGuestPlanRevisionId: string | null;
    }>
  >;
  synchronize(
    input: Readonly<{
      bookingId: string;
      sourceGuestPlanRevisionId: string;
      sourceSequence: number;
      expectedAttendees: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingRevision: number;
      appliedSourceSequence: number;
      outcome: 'APPLIED' | 'REPLAYED' | 'IGNORED_STALE';
    }>
  >;
}
export interface GuestOwnerPorts {
  booking: BookingMediaPrerequisiteReader;
  timeline: BookingTimelineSnapshotReader;
  planning: GuestBookingPlanningPort;
  capacity: {
    requireCapacity(hallId: string, headcount: number, context: ContractContext): Promise<void>;
  };
  invitation?: GuestInvitationReader;
}
export const GUEST_PROVIDER_VERSION = 'guest-management@1.0.0' as const;

/** In-process Notifications hand-off. Never a HTTP bearer authorization or send. */
export type GuestDeliveryRecipient = Readonly<{
  bookingId: string;
  guestId: string;
  intendedEmail: string;
}>;
export type GuestDeliveryPreparation = Readonly<{
  publicInvitationId: string;
  publishedRevisionId: string;
  credentialId: string;
  expiresAt: string;
  intendedEmail: string;
}>;

/** Privileged transient command, enlisted in the Guest transaction. No raw
 * credential is persisted in Guest command receipts or ordinary events. */
export interface PersonalizedInvitationDeliveryPort {
  enqueue(
    tx: Prisma.TransactionClient,
    command: Readonly<{
      bookingId: string;
      guestId: string;
      credentialId: string;
      credential: string;
      intendedEmail: string;
      expiresAt: Date;
    }>,
  ): Promise<string>;
}
