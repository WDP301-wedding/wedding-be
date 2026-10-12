import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { createPrismaAuditRepository } from '../../../core/audit/audit.repository.js';
import type { createInvitationEditorReader } from '../../identity-access/authorization/invitation-editor.reader.js';
import type {
  BookingMediaPrerequisiteReader,
  BookingTimelineSnapshotReader,
} from '../../booking-lifecycle/application/booking-readers.js';
import type { BookingPlanningSnapshotReader } from '../../booking-lifecycle/application/planning-snapshot.reader.js';
import type { VenueSelectionEligibilityReader } from '../../venue-catalog/application/selection-eligibility.reader.js';
import type { VenueCatalogReader } from '../../venue-catalog/application/venue-catalog.provider.js';
import type {
  PrintableSeatingContentRegistry,
  InvitationPublicationReader,
  SeatingRegistration,
} from '../application/studio.contracts.js';
import {
  id,
  parseStudio,
  designContentSchema,
  registerSeatingSchema,
  invalidateSeatingSchema,
  seatingRenderSchema,
  validityProofSchema,
  digest,
  studioConflict,
} from '../domain/studio-policy.js';
import { type StudioRepository, asJson } from './studio.repository.js';

const captureSchema = z.strictObject({ bookingId: id, designRevisionId: id });
export class PrintableService implements PrintableSeatingContentRegistry {
  constructor(
    readonly repository: StudioRepository,
    readonly editor: ReturnType<typeof createInvitationEditorReader>,
    readonly booking: BookingMediaPrerequisiteReader,
    readonly timeline: BookingTimelineSnapshotReader,
    readonly planning: BookingPlanningSnapshotReader,
    readonly venue: VenueSelectionEligibilityReader,
    readonly publication: InvitationPublicationReader,
    readonly layouts: Pick<VenueCatalogReader, 'resolveLayoutTemplateVersion'>,
  ) {}

  async registerConfirmed(
    value: SeatingRegistration,
    context: ContractContext,
  ): Promise<{ registered: true; replayed: boolean }> {
    const input = parseStudio(registerSeatingSchema, value);
    const tx = this.repository.boundary.requireScope(input.bookingId, context);
    await this.authorize(input.bookingId, context);
    if (input.validityProof === undefined)
      throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
    if (digest(input.renderSnapshot) !== input.contentDigest)
      throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    const existing = await tx.invitationSeatingRevision.findUnique({
      where: { id: input.seatingPlanRevisionId },
    });
    const removedIdentity = await tx.invitationSeatingInvalidation.findFirst({
      where: { seatingPlanRevisionId: input.seatingPlanRevisionId },
    });
    if (
      removedIdentity !== null &&
      (removedIdentity.bookingId !== input.bookingId ||
        removedIdentity.revisionNumber !== input.seatingPlanRevisionNumber)
    )
      throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    if (existing !== null) {
      if (
        existing.bookingId !== input.bookingId ||
        existing.revisionNumber !== input.seatingPlanRevisionNumber ||
        existing.contentDigest !== input.contentDigest ||
        existing.layoutTemplateVersionId !== input.layoutTemplateVersionId ||
        digest(existing.renderSnapshot) !== digest(input.renderSnapshot) ||
        digest(existing.validityProof) !== digest(input.validityProof)
      )
        throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
      return { registered: true, replayed: true };
    }
    const duplicateNumber = await tx.invitationSeatingRevision.findUnique({
      where: {
        bookingId_revisionNumber: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
        },
      },
    });
    if (duplicateNumber !== null) throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    const state = await tx.invitationSeatingState.findUnique({
      where: { bookingId: input.bookingId },
    });
    const invalidation = await tx.invitationSeatingInvalidation.findUnique({
      where: {
        bookingId_revisionNumber: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
        },
      },
    });
    if (invalidation !== null && invalidation.seatingPlanRevisionId !== input.seatingPlanRevisionId)
      throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    // Delayed/equal invalidated content is immutable history, never a new eligibility.
    const eligible =
      invalidation === null &&
      (state === null || input.seatingPlanRevisionNumber > state.revisionNumber);
    if (eligible) {
      await this.checkProof(
        input.bookingId,
        input.layoutTemplateVersionId,
        input.validityProof,
        context,
        true,
      );
      const layout = await this.layouts.resolveLayoutTemplateVersion(input.layoutTemplateVersionId);
      if (
        input.renderSnapshot.length !== layout.tables.length ||
        input.renderSnapshot.some((table) => {
          const source = layout.tables.find((item) => item.tableId === table.layoutTableId);
          return (
            source === undefined ||
            source.label !== table.tableLabel ||
            source.shape !== table.shape ||
            source.x !== table.x ||
            source.y !== table.y ||
            source.width !== table.width ||
            source.height !== table.height ||
            source.rotationDegrees !== table.rotationDegrees
          );
        })
      )
        throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    }
    await tx.invitationSeatingRevision.create({
      data: {
        id: input.seatingPlanRevisionId,
        bookingId: input.bookingId,
        revisionNumber: input.seatingPlanRevisionNumber,
        layoutTemplateVersionId: input.layoutTemplateVersionId,
        contentDigest: input.contentDigest,
        renderSnapshot: asJson(input.renderSnapshot),
        validityProof: asJson(input.validityProof),
      },
    });
    if (eligible)
      await tx.invitationSeatingState.upsert({
        where: { bookingId: input.bookingId },
        create: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
          revisionId: input.seatingPlanRevisionId,
          status: 'ELIGIBLE',
        },
        update: {
          revisionNumber: input.seatingPlanRevisionNumber,
          revisionId: input.seatingPlanRevisionId,
          status: 'ELIGIBLE',
        },
      });
    await this.audit(
      tx,
      context,
      'invitation.seating-registered',
      input.seatingPlanRevisionId,
      input.seatingPlanRevisionNumber,
    );
    return { registered: true, replayed: false };
  }
  async markRequiresReview(
    value: z.input<typeof invalidateSeatingSchema>,
    context: ContractContext,
  ): Promise<{ invalidated: true; replayed: boolean }> {
    const input = parseStudio(invalidateSeatingSchema, value);
    if (context.authority === 'SYSTEM' && context.transactionScopeId === undefined) {
      return this.repository.boundary.runSystemInvalidation(
        { bookingId: input.bookingId, context, purpose: 'SEATING_REGISTRY_INVALIDATION' },
        (scoped) => this.markRequiresReview(input, scoped),
      );
    }
    const tx = this.repository.boundary.requireScope(input.bookingId, context);
    if (context.authority === 'AUTHENTICATED') await this.authorize(input.bookingId, context);
    else if (context.actorAccountId !== null) throw new ValidationError();
    const registeredIdentity = await tx.invitationSeatingRevision.findUnique({
      where: { id: input.seatingPlanRevisionId },
    });
    const removedIdentity = await tx.invitationSeatingInvalidation.findFirst({
      where: { seatingPlanRevisionId: input.seatingPlanRevisionId },
    });
    if (
      [registeredIdentity, removedIdentity].some(
        (row) =>
          row !== null &&
          (row.bookingId !== input.bookingId ||
            row.revisionNumber !== input.seatingPlanRevisionNumber),
      )
    )
      throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    const prior = await tx.invitationSeatingInvalidation.findUnique({
      where: {
        bookingId_revisionNumber: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
        },
      },
    });
    if (prior !== null) {
      if (prior.seatingPlanRevisionId !== input.seatingPlanRevisionId)
        throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
      return { invalidated: true, replayed: true };
    }
    const registered = await tx.invitationSeatingRevision.findUnique({
      where: {
        bookingId_revisionNumber: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
        },
      },
    });
    if (registered !== null && registered.id !== input.seatingPlanRevisionId)
      throw studioConflict('PRINTABLE_SEATING_DIGEST_CONFLICT');
    await tx.invitationSeatingInvalidation.create({
      data: {
        id: randomUUID(),
        bookingId: input.bookingId,
        seatingPlanRevisionId: input.seatingPlanRevisionId,
        revisionNumber: input.seatingPlanRevisionNumber,
        reasonCode: input.reasonCode,
      },
    });
    const state = await tx.invitationSeatingState.findUnique({
      where: { bookingId: input.bookingId },
    });
    if (state === null || input.seatingPlanRevisionNumber >= state.revisionNumber)
      await tx.invitationSeatingState.upsert({
        where: { bookingId: input.bookingId },
        create: {
          bookingId: input.bookingId,
          revisionNumber: input.seatingPlanRevisionNumber,
          revisionId: input.seatingPlanRevisionId,
          status: 'REQUIRES_REVIEW',
        },
        update: {
          revisionNumber: input.seatingPlanRevisionNumber,
          revisionId: input.seatingPlanRevisionId,
          status: 'REQUIRES_REVIEW',
        },
      });
    await this.audit(
      tx,
      context,
      'invitation.seating-invalidated',
      input.seatingPlanRevisionId,
      input.seatingPlanRevisionNumber,
    );
    return { invalidated: true, replayed: false };
  }
  /** Internal print-capture port, enlisted by W5 approval; no HTTP approval bypass. */
  async capture(value: unknown, context: ContractContext) {
    const input = parseStudio(captureSchema, value);
    const tx = this.repository.boundary.requireScope(input.bookingId, context);
    await this.authorize(input.bookingId, context);
    const source = await tx.invitationDesignRevision.findFirst({
      where: { id: input.designRevisionId, bookingId: input.bookingId },
    });
    if (source === null) throw new NotFoundError();
    const head = await tx.invitationDesign.findUniqueOrThrow({ where: { id: source.designId } });
    if (head.currentRevisionId !== source.id) throw studioConflict('PRINT_QUOTE_STALE');
    const design = parseStudio(designContentSchema, source.content);
    const event = await this.booking.requireConfirmedEventContext(input.bookingId);
    const timeline = await this.timeline.resolveApprovedRevision(
      { bookingId: input.bookingId, timelineRevisionId: event.effectiveTimelineRevisionId },
      context,
    );
    if (
      !timeline.isEffective ||
      timeline.eventDate !== event.eventDate ||
      timeline.shiftCode !== event.shiftCode
    )
      throw studioConflict('PRINTABLE_TIMELINE_NOT_EFFECTIVE');
    const publicIdentity = await this.publication.requirePublishedPublicInvitation(input.bookingId);
    const identity = await tx.invitationPublicIdentity.findUniqueOrThrow({
      where: { bookingId: input.bookingId },
    });
    let seating: {
      seatingPlanRevisionId: string;
      renderSnapshot: z.output<typeof seatingRenderSchema>;
    } | null = null;
    if (design.includesSeating) {
      const state = await tx.invitationSeatingState.findUnique({
        where: { bookingId: input.bookingId },
      });
      if (state === null || state.status !== 'ELIGIBLE')
        throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
      const row = await tx.invitationSeatingRevision.findUniqueOrThrow({
        where: { id: state.revisionId },
      });
      if (row.validityProof === null) throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
      const proof = parseStudio(validityProofSchema, row.validityProof);
      await this.checkProof(input.bookingId, row.layoutTemplateVersionId, proof, context);
      seating = {
        seatingPlanRevisionId: row.id,
        renderSnapshot: parseStudio(seatingRenderSchema, row.renderSnapshot),
      };
    }
    const content = {
      design,
      timeline,
      seating,
      genericQrPayload: identity.publicUrl,
      publicInvitationId: publicIdentity.publicInvitationId,
      publishedRevisionId: publicIdentity.publishedRevisionId,
    };
    const printableRevisionId = randomUUID(),
      contentDigest = digest(content);
    await tx.invitationPrintableRevision.create({
      data: {
        id: printableRevisionId,
        bookingId: input.bookingId,
        designRevisionId: source.id,
        timelineRevisionId: timeline.timelineRevisionId,
        seatingPlanRevisionId: seating?.seatingPlanRevisionId ?? null,
        publicInvitationId: identity.id,
        contentDigest,
        content: asJson(content),
      },
    });
    await this.audit(tx, context, 'invitation.printable-captured', printableRevisionId, 1);
    return { printableRevisionId, contentDigest, content };
  }
  private async checkProof(
    bookingId: string,
    layoutId: string,
    proof: z.output<typeof validityProofSchema>,
    context: ContractContext,
    requireCurrentProof = false,
  ) {
    const current = await this.planning.getCurrent(bookingId, context);
    const event = await this.booking.requireConfirmedEventContext(bookingId);
    const venue = await this.venue.getLayoutEligibility(layoutId, context);
    const layout = await this.layouts.resolveLayoutTemplateVersion(layoutId);
    if (layout.minGuests !== proof.minGuests || layout.maxGuests !== proof.maxGuests)
      throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
    if (
      venue.hallId !== event.hallId ||
      !venue.hallActive ||
      !venue.templateActive ||
      venue.totalSeatCapacity !== proof.totalSeatCapacity ||
      current.planningHeadcount < 1 ||
      current.planningHeadcount > Math.min(venue.hallMaxGuests, venue.totalSeatCapacity)
    )
      throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
    const exception = proof.managerException;
    const inRange =
      current.planningHeadcount >= proof.minGuests && current.planningHeadcount <= proof.maxGuests;
    if (
      exception !== null &&
      (exception.approvedBookingRevision !== current.bookingRevision ||
        exception.approvedHeadcount !== current.planningHeadcount)
    )
      throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
    if (!inRange && exception === null) throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
    if (
      current.planningHeadcount !== proof.expectedAttendees ||
      (requireCurrentProof && current.bookingRevision !== proof.bookingRevision)
    )
      throw studioConflict('PRINTABLE_SEATING_REQUIRES_REVIEW');
  }
  private async authorize(bookingId: string, context: ContractContext) {
    const actor = await this.editor.resolveContext(context);
    if (!actor.roles.includes('MANAGER')) {
      if (!actor.roles.includes('COUPLE')) throw new NotFoundError();
      await this.booking.requireBookingAccess({
        bookingId,
        accountId: actor.accountId,
        minimum: 'FULL',
      });
    }
    await this.booking.requireConfirmedEventContext(bookingId);
  }
  private async audit(
    tx: Prisma.TransactionClient,
    context: ContractContext,
    action: string,
    entityId: string,
    revision: number,
  ) {
    await createPrismaAuditRepository(tx).append({
      occurredAt: new Date(),
      requestId: context.requestId,
      actorType: context.authority === 'SYSTEM' ? 'SYSTEM' : 'USER',
      actorId: context.actorAccountId,
      action,
      entityType: 'INVITATION',
      entityId,
      metadata: { revision },
    });
  }
}
