import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { z } from 'zod';
import type { registerSeatingSchema, invalidateSeatingSchema } from '../domain/studio-policy.js';
export {
  seatingRenderSchema,
  validityProofSchema,
  digest as computePrintableSeatingDigest,
} from '../domain/studio-policy.js';

export interface InvitationPublicationReader {
  requirePublishedPublicInvitation(bookingId: string): Promise<{
    publicInvitationId: string;
    publicSlug: string;
    publishedRevisionId: string;
  }>;
  resolvePrintableRevision(printableRevisionId: string): Promise<{
    bookingId: string;
    designRevisionId: string;
    timelineRevisionId: string;
    seatingPlanRevisionId: string | null;
    publicInvitationId: string;
    contentDigest: string;
  }>;
}
export type SeatingRegistration = Readonly<
  Omit<z.input<typeof registerSeatingSchema>, 'renderSnapshot'> & {
    renderSnapshot: readonly Readonly<
      z.input<typeof registerSeatingSchema>['renderSnapshot'][number]
    >[];
  }
>;
export interface PrintableSeatingContentRegistry {
  registerConfirmed(
    input: SeatingRegistration,
    context: ContractContext,
  ): Promise<{ registered: true; replayed: boolean }>;
  markRequiresReview(
    input: Readonly<z.input<typeof invalidateSeatingSchema>>,
    context: ContractContext,
  ): Promise<{ invalidated: true; replayed: boolean }>;
}
