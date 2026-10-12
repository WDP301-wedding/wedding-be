import type { ContractContext } from '../../../core/database/booking-boundary.js';
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

/** Only the privileged delivery adapter receives a transient token inside the
 * Guest command's shared transaction. Its receipt must contain identifiers only. */
export interface GuestCredentialDelivery {
  retain(
    command: Readonly<{
      bookingId: string;
      guestId: string;
      intendedEmail: string;
      credentialId: string;
      credential: string;
      expiresAt: Date;
      publicInvitationId: string;
      publishedRevisionId: string;
    }>,
    scope: ContractContext,
  ): Promise<{ notificationIntentId: string }>;
}
