import { z } from 'zod';
import type { AiImageProvider } from '../../../integrations/ai-image/ai-image-provider.js';
import {
  AiImageProviderDisabledError,
  AiImageInvalidOutputError,
  createGeneratedAiImage,
} from '../../../integrations/ai-image/ai-image-provider.js';
import { generateAiImageCommandSchema } from '../../../integrations/ai-image/ai-image.schemas.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import type { MediaService } from '../application/media.service.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import { digest, id, parseStudio, studioConflict } from '../domain/studio-policy.js';
import { type StudioRepository } from './studio.repository.js';
import { type StudioAuthorization } from './studio-authorization.js';
import { SharpMediaInspector } from './sharp-media.inspector.js';
import {
  generationRecoveryQuery,
  generationReconcileCommand,
} from '../domain/generation-recovery.js';
import { createStorageObjectReference } from '../../../integrations/storage/storage-provider.js';
import { createPrismaAuditRepository } from '../../../core/audit/audit.repository.js';
import { NotFoundError } from '../../../core/errors/app-error.js';

const schema = generateAiImageCommandSchema.safeExtend({
  bookingId: id,
  idempotencyKey: z.string(),
});
export class GenerationService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly media: MediaService,
    readonly provider: AiImageProvider | null,
    readonly inspector = new SharpMediaInspector(),
  ) {}
  async generate(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(schema, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'ai.generate', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        if (this.provider === null) throw new AiImageProviderDisabledError();
        const provider = this.provider;
        const intentDigest = digest({ actorId: context.actorId, key: input.idempotencyKey });
        const existing = await this.repository.prisma.invitationGenerationIntent.findUnique({
          where: { bookingId_intentDigest: { bookingId: input.bookingId, intentDigest } },
        });
        if (existing !== null) {
          if (existing.status === 'FAILED')
            throw new AppError({
              status: existing.errorStatus!,
              code: existing.errorCode!,
              message: 'The image generation failed.',
            });
          const uploadKey = `ai-${intentDigest}`;
          const attempt = await this.repository.prisma.invitationMediaUploadAttempt.findFirst({
            where: {
              bookingId: input.bookingId,
              intentKeyDigest: digest([context.actorId, uploadKey]),
            },
            orderBy: { sequence: 'desc' },
          });
          if (attempt !== null && this.media.storage.read !== undefined) {
            const bytes = await this.media.storage
              .read(
                createStorageObjectReference({
                  objectKey: attempt.objectKey,
                  purpose: 'PRIVATE_WEDDING_MEDIA',
                  resourceId: input.bookingId,
                }),
              )
              .catch((error: unknown) => {
                if (error instanceof NotFoundError) return undefined;
                throw error;
              });
            if (bytes !== undefined) {
              const image = createGeneratedAiImage(bytes, 'image/png');
              const recovered = await this.media.upload(
                {
                  bookingId: input.bookingId,
                  bytes: image.bytes,
                  contentType: 'image/png',
                  altText: 'AI invitation artwork',
                  idempotencyKey: uploadKey,
                },
                scoped,
              );
              await tx.invitationGenerationIntent.update({
                where: {
                  bookingId_intentDigest: {
                    bookingId: input.bookingId,
                    intentDigest,
                  },
                },
                data: { status: 'ACCEPTED', mediaAssetId: recovered.id },
              });
              await this.repository.audit(
                tx,
                scoped,
                'invitation.image-generation-recovered',
                recovered.id,
                recovered.revision,
              );
              return {
                mediaAssetId: recovered.id,
                revision: recovered.revision,
                detachedAt: null,
                previewPath: `/api/v1/bookings/${input.bookingId}/media/${recovered.id}`,
              };
            }
          }
          throw new AppError({
            status: 503,
            code: 'AI_GENERATION_PENDING',
            message:
              'The prior provider effect requires reconciliation; retry cannot generate another image.',
          });
        }
        const quota = await tx.invitationMediaAsset.findMany({
          where: { bookingId: input.bookingId, detachedAt: null },
          include: { currentFile: true },
          take: 101,
        });
        if (
          quota.length >= MEDIA_LIMITS.activeFiles ||
          quota.reduce((total, asset) => total + asset.currentFile.sizeBytes, 0) >=
            MEDIA_LIMITS.activeBytes
        )
          throw studioConflict('MEDIA_QUOTA_EXCEEDED');
        const actor = await this.access.guard.requireAccess(input.bookingId, scoped);
        const policy = await tx.invitationMediaPolicy.findUnique({
          where: { bookingId: input.bookingId },
        });
        const cutoff = policy?.cutoffAt ?? new Date(actor.eventStartAt.getTime() - 72 * 3600000);
        if (this.media.now().getTime() >= cutoff.getTime())
          throw studioConflict('MEDIA_CUTOFF_REACHED');
        await this.repository.prisma.invitationGenerationIntent.create({
          data: { bookingId: input.bookingId, intentDigest, commandDigest: digest(input) },
        });
        let outputValidated = false;
        try {
          const output = await provider.generate({
            prompt: input.prompt,
            aspectRatio: input.aspectRatio,
          });
          const image = createGeneratedAiImage(output.bytes, output.contentType);
          const decoded = await this.inspector
            .inspect(image.bytes, { maxDimension: 4096, maxPixels: 16777216 })
            .catch((error: unknown) => {
              if (error instanceof AppError && error.status === 422)
                throw new AiImageInvalidOutputError();
              throw error;
            });
          if (
            decoded.contentType !== 'image/png' ||
            decoded.width !== output.width ||
            decoded.height !== output.height ||
            image.sizeBytes !== output.sizeBytes
          )
            throw new AiImageInvalidOutputError();
          outputValidated = true;
          const asset = await this.media.upload(
            {
              bookingId: input.bookingId,
              bytes: image.bytes,
              contentType: 'image/png',
              altText: 'AI invitation artwork',
              idempotencyKey: `ai-${intentDigest}`,
            },
            scoped,
          );
          await tx.invitationGenerationIntent.update({
            where: { bookingId_intentDigest: { bookingId: input.bookingId, intentDigest } },
            data: { status: 'ACCEPTED', mediaAssetId: asset.id },
          });
          await this.repository.audit(
            tx,
            scoped,
            'invitation.image-generated',
            asset.id,
            asset.revision,
          );
          return {
            mediaAssetId: asset.id,
            revision: asset.revision,
            detachedAt: null,
            previewPath: `/api/v1/bookings/${input.bookingId}/media/${asset.id}`,
          };
        } catch (error: unknown) {
          // UNKNOWN/timeout cannot trigger a second paid generation. Terminal known
          // failures are retained separately from acceptance rollback, without prompt.
          if (
            !outputValidated &&
            error instanceof AppError &&
            [409, 422, 502].includes(error.status)
          ) {
            await this.repository.prisma.invitationGenerationIntent.update({
              where: { bookingId_intentDigest: { bookingId: input.bookingId, intentDigest } },
              data: { status: 'FAILED', errorCode: error.code, errorStatus: error.status },
            });
          }
          throw error;
        }
      },
      { action: 'ai.generate' },
    );
  }
  async listPending(bookingValue: string, value: unknown, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      query = parseStudio(generationRecoveryQuery, value);
    await this.access.booking(bookingId, context, 'MANAGER');
    const rows = await this.repository.prisma.invitationGenerationIntent.findMany({
      where: {
        bookingId,
        status: 'PENDING',
        ...(query.cursor === undefined ? {} : { intentDigest: { gt: query.cursor } }),
      },
      orderBy: { intentDigest: 'asc' },
      take: query.limit + 1,
    });
    await this.access.booking(bookingId, context, 'MANAGER');
    return {
      items: rows.slice(0, query.limit).map((row) => ({
        intentDigest: row.intentDigest,
        status: 'PENDING' as const,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.intentDigest : null,
    };
  }
  async reconcile(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(generationReconcileCommand, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'ai.reconcile', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx, 'MANAGER'),
      async (tx, scoped) => {
        const row = await tx.invitationGenerationIntent.findUnique({
          where: {
            bookingId_intentDigest: {
              bookingId: input.bookingId,
              intentDigest: input.intentDigest,
            },
          },
        });
        if (row === null) throw new NotFoundError();
        if (row.status !== 'PENDING') throw studioConflict('AI_GENERATION_RECONCILIATION_STALE');
        await tx.invitationGenerationIntent.update({
          where: {
            bookingId_intentDigest: {
              bookingId: input.bookingId,
              intentDigest: input.intentDigest,
            },
          },
          data: { status: 'FAILED', errorCode: 'AI_GENERATION_ABANDONED', errorStatus: 502 },
        });
        await createPrismaAuditRepository(tx).append({
          occurredAt: new Date(),
          requestId: scoped.requestId,
          actorType: 'USER',
          actorId: scoped.actorId,
          action: 'invitation.image-generation-abandoned',
          entityType: 'INVITATION',
          entityId: input.bookingId,
          metadata: {
            intentDigest: input.intentDigest,
            outcome: input.outcome,
            evidenceReference: input.evidenceReference,
          },
        });
        return {
          intentDigest: input.intentDigest,
          status: 'FAILED' as const,
          outcome: input.outcome,
        };
      },
      { action: 'ai.reconcile', resourceId: input.intentDigest },
    );
  }
}
