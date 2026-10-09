import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  BookingMediaPrerequisiteReader,
  BookingTimelineSnapshotReader,
} from '../../booking-lifecycle/application/booking-readers.js';
import { NotFoundError, ServiceUnavailableError } from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import type { InvitationPublicationReader } from '../application/studio.contracts.js';
import {
  id,
  parseStudio,
  revision,
  designContentSchema,
  studioConflict,
} from '../domain/studio-policy.js';
import { publicInvitationSchema } from '../domain/public-invitation.js';
import { asJson, contractContext, type StudioRepository } from './studio.repository.js';
import { type StudioAuthorization } from './studio-authorization.js';

const publishSchema = z.strictObject({
  bookingId: id,
  designId: id,
  expectedRevision: revision,
  designRevisionId: id,
  expectedPublicationRevision: z.int().nonnegative(),
  idempotencyKey: z.string(),
});
const unpublishSchema = z.strictObject({
  bookingId: id,
  designId: id.optional(),
  expectedRevision: revision,
  idempotencyKey: z.string(),
});

export class PublicationService implements InvitationPublicationReader {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly booking: BookingMediaPrerequisiteReader,
    readonly timeline: BookingTimelineSnapshotReader,
    readonly publicOrigin: string | null,
    readonly now: () => Date = () => new Date(),
  ) {}
  async publish(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(publishSchema, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'publication.publish', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx),
      async (tx, scoped) => {
        if (this.publicOrigin === null) throw new ServiceUnavailableError();
        const design = await tx.invitationDesign.findFirst({
          where: { id: input.designId, bookingId: input.bookingId },
        });
        if (design === null) throw new NotFoundError();
        if (
          design.revision !== input.expectedRevision ||
          design.currentRevisionId !== input.designRevisionId
        )
          throw studioConflict('INVITATION_DESIGN_STALE');
        const source = await tx.invitationDesignRevision.findUniqueOrThrow({
          where: { id: design.currentRevisionId },
        });
        const content = parseStudio(designContentSchema, source.content);
        let identity = await tx.invitationPublicIdentity.findUnique({
          where: { bookingId: input.bookingId },
        });
        if ((identity?.revision ?? 0) !== input.expectedPublicationRevision)
          throw studioConflict('INVITATION_PUBLICATION_STALE');
        if (identity === null) {
          const slug = randomBytes(32).toString('hex');
          identity = await tx.invitationPublicIdentity.create({
            data: {
              bookingId: input.bookingId,
              id: randomUUID(),
              slug,
              publicUrl: new URL(
                `/api/v1/public/invitations/${slug}/render`,
                this.publicOrigin,
              ).toString(),
            },
          });
        }
        const event = await this.booking.requireConfirmedEventContext(input.bookingId);
        const timeline = await this.timeline.resolveApprovedRevision(
          { bookingId: input.bookingId, timelineRevisionId: event.effectiveTimelineRevisionId },
          contractContext(scoped),
        );
        if (
          !timeline.isEffective ||
          timeline.eventDate !== event.eventDate ||
          timeline.shiftCode !== event.shiftCode
        )
          throw studioConflict('PRINTABLE_TIMELINE_NOT_EFFECTIVE');
        const assets = await tx.invitationDerivedAsset.findMany({
          where: { bookingId: input.bookingId, id: { in: content.derivedAssetIds } },
        });
        if (assets.length !== content.derivedAssetIds.length) throw new NotFoundError();
        const urls = new Map(
          assets.map((asset) => [asset.id, `/api/v1/public/invitation-assets/${asset.publicSlug}`]),
        );
        const publishedRevisionId = randomUUID();
        const publicContent = publicInvitationSchema.parse({
          publicInvitationId: identity.id,
          publishedRevisionId,
          title: content.title,
          textFields: content.textFields,
          sections: content.sections.map((section) => ({
            kind: section.kind,
            textKey: section.textKey,
            imageUrl: section.derivedAssetId === null ? null : urls.get(section.derivedAssetId),
          })),
          event: {
            eventDate: timeline.eventDate,
            hallName: timeline.hallName,
            shiftCode: timeline.shiftCode,
          },
          timeline: timeline.items.map((item) => ({
            order: item.order,
            startTime: item.startTime,
            title: item.title,
            description: item.description,
          })),
          assets: content.derivedAssetIds.map((assetId) => {
            const asset = assets.find((item) => item.id === assetId)!;
            return {
              url: urls.get(assetId),
              width: asset.width,
              height: asset.height,
              contentType: 'image/png',
            };
          }),
          genericQrPayload: identity.publicUrl,
        });
        await tx.invitationPublishedRevision.create({
          data: {
            id: publishedRevisionId,
            bookingId: input.bookingId,
            designRevisionId: source.id,
            content: asJson(publicContent),
            assetIds: content.derivedAssetIds,
          },
        });
        const publicationRevision = identity.revision + 1;
        await tx.invitationPublicIdentity.update({
          where: { bookingId: input.bookingId },
          data: { currentPublicationId: publishedRevisionId, revision: publicationRevision },
        });
        await this.repository.audit(
          tx,
          scoped,
          'invitation.published',
          identity.id,
          publicationRevision,
        );
        await this.repository.publicationEvent(tx, input.bookingId, scoped, {
          publicInvitationId: identity.id,
          publishedRevisionId,
          published: true,
          changedAt: this.now().toISOString(),
        });
        return {
          publicInvitationId: identity.id,
          publicSlug: identity.slug,
          publishedRevisionId,
          publicationRevision,
          genericQrPayload: identity.publicUrl,
        };
      },
      { action: 'publication.publish', resourceId: input.designId },
    );
  }
  async unpublish(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(unpublishSchema, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'publication.unpublish', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx),
      async (tx, scoped) => {
        const identity = await tx.invitationPublicIdentity.findUnique({
          where: { bookingId: input.bookingId },
        });
        if (identity === null) throw new NotFoundError();
        if (identity.revision !== input.expectedRevision)
          throw studioConflict('INVITATION_PUBLICATION_STALE');
        if (identity.currentPublicationId === null) throw new NotFoundError();
        if (input.designId !== undefined) {
          const published = await tx.invitationPublishedRevision.findUniqueOrThrow({
            where: { id: identity.currentPublicationId },
          });
          const source = await tx.invitationDesignRevision.findUniqueOrThrow({
            where: { id: published.designRevisionId },
          });
          if (source.designId !== input.designId) throw new NotFoundError();
        }
        await tx.invitationPublicIdentity.update({
          where: { bookingId: input.bookingId },
          data: { currentPublicationId: null, revision: identity.revision + 1 },
        });
        await this.repository.audit(
          tx,
          scoped,
          'invitation.unpublished',
          identity.id,
          identity.revision + 1,
        );
        // Separate removal fact preserves the frozen publication-changed meaning.
        await this.repository.publicationEvent(tx, input.bookingId, scoped, {
          publicInvitationId: identity.id,
          publishedRevisionId: identity.currentPublicationId,
          published: false,
          changedAt: this.now().toISOString(),
        });
        return {
          publicInvitationId: identity.id,
          publicationRevision: identity.revision + 1,
          published: false,
        };
      },
      { action: 'publication.unpublish', resourceId: input.designId ?? null },
    );
  }
  async readPublic(slug: string) {
    if (!/^[a-f0-9]{64}$/u.test(slug)) throw new NotFoundError();
    const identity = await this.repository.prisma.invitationPublicIdentity.findUnique({
      where: { slug },
    });
    if (identity === null || identity.currentPublicationId === null) throw new NotFoundError();
    const row = await this.repository.prisma.invitationPublishedRevision.findUniqueOrThrow({
      where: { id: identity.currentPublicationId },
    });
    const latest = await this.repository.prisma.invitationPublicIdentity.findUnique({
      where: { bookingId: identity.bookingId },
    });
    if (latest?.currentPublicationId !== row.id) throw new NotFoundError();
    return publicInvitationSchema.parse(row.content);
  }
  async requirePublishedPublicInvitation(value: string) {
    const bookingId = parseStudio(id, value);
    const db = this.repository.boundary.current(bookingId) ?? this.repository.prisma;
    const row = await db.invitationPublicIdentity.findUnique({ where: { bookingId } });
    if (row === null || row.currentPublicationId === null) throw new NotFoundError();
    return {
      publicInvitationId: row.id,
      publicSlug: row.slug,
      publishedRevisionId: row.currentPublicationId,
    };
  }
  async resolvePrintableRevision(value: string) {
    const printableRevisionId = parseStudio(id, value);
    const db = this.repository.boundary.current() ?? this.repository.prisma;
    const row = await db.invitationPrintableRevision.findUnique({
      where: { id: printableRevisionId },
    });
    if (row === null) throw new NotFoundError();
    if (this.repository.boundary.current() !== undefined)
      this.repository.boundary.current(row.bookingId);
    return {
      bookingId: row.bookingId,
      designRevisionId: row.designRevisionId,
      timelineRevisionId: row.timelineRevisionId,
      seatingPlanRevisionId: row.seatingPlanRevisionId,
      publicInvitationId: row.publicInvitationId,
      contentDigest: row.contentDigest,
    };
  }
}
