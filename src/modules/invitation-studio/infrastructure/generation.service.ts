import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AiImageProvider } from '../../../integrations/ai-image/ai-image-provider.js';
import {
  AiImageProviderDisabledError,
  AiImageInvalidOutputError,
  createGeneratedAiImage,
} from '../../../integrations/ai-image/ai-image-provider.js';
import {
  generateAiImageCommandSchema,
  MAX_AI_IMAGE_BYTES,
} from '../../../integrations/ai-image/ai-image.schemas.js';
import {
  AppError,
  IdempotencyKeyReusedError,
  NotFoundError,
  ProviderError,
} from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import type { MediaService } from '../application/media.service.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import { digest, id, parseStudio, studioConflict } from '../domain/studio-policy.js';
import { asJson, type StudioRepository } from './studio.repository.js';
import type { StudioAuthorization } from './studio-authorization.js';
import { SharpMediaInspector } from './sharp-media.inspector.js';
import {
  generationRecoveryQuery,
  generationReconcileCommand,
} from '../domain/generation-recovery.js';
import {
  createStorageObjectReference,
  createStoredObject,
} from '../../../integrations/storage/storage-provider.js';
import { createPrismaAuditRepository } from '../../../core/audit/audit.repository.js';
import { StudioExternalWork, checkMediaQuota } from './external-work.js';
import { requireActiveStudioRequest, studioPhase } from './studio-phase.js';

const schema = generateAiImageCommandSchema.safeExtend({
  bookingId: id,
  idempotencyKey: z.string(),
});
const pending = () =>
  new AppError({
    status: 503,
    code: 'AI_GENERATION_PENDING',
    message:
      'The prior provider effect requires reconciliation; retry cannot generate another image.',
  });

export class GenerationService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly media: MediaService,
    readonly provider: AiImageProvider | null,
    readonly inspector = new SharpMediaInspector(),
  ) {}

  private async uploadPolicy(tx: Prisma.TransactionClient, bookingId: string, eventStartAt: Date) {
    const policy = await tx.invitationMediaPolicy.findUnique({ where: { bookingId } });
    const cutoffAt =
      policy?.cutoffAt ?? new Date(eventStartAt.getTime() - MEDIA_LIMITS.cutoffLeadMs);
    if (this.media.now().getTime() >= cutoffAt.getTime())
      throw studioConflict('MEDIA_CUTOFF_REACHED');
    return { revision: policy?.revision ?? 0, cutoffAt };
  }

  async generate(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(schema, value);
    const intentDigest = digest({ actorId: context.actorId, key: input.idempotencyKey });
    const intentWhere = { bookingId_intentDigest: { bookingId: input.bookingId, intentDigest } };
    const uploadKey = 'ai-' + intentDigest;
    const receiptKey = createHash('sha256')
      .update(JSON.stringify([context.actorId, uploadKey]))
      .digest('hex');
    const external = new StudioExternalWork(this.repository);
    let eventStartAt: Date;
    return external.run(
      {
        bookingId: input.bookingId,
        idempotencyKey: input.idempotencyKey,
        payload: { action: 'ai.generate', ...input },
        operation: { action: 'ai.generate' },
      },
      context,
      async (scoped) => {
        eventStartAt = (await this.access.bookingActor(input.bookingId, scoped, 'COUPLE'))
          .eventStartAt;
      },
      async (tx) => {
        if (!this.provider) throw new AiImageProviderDisabledError();
        const existing = await tx.invitationGenerationIntent.findUnique({ where: intentWhere });
        if (existing && existing.commandDigest !== digest(input))
          throw new IdempotencyKeyReusedError();
        if (existing?.status === 'FAILED')
          throw new AppError({
            status: existing.errorStatus!,
            code: existing.errorCode!,
            message: 'The image generation failed.',
          });
        const policy = await this.uploadPolicy(tx, input.bookingId, eventStartAt);
        if (!existing) {
          // Commits before a paid call; acceptance rollback must not erase this.
          await tx.invitationGenerationIntent.create({
            data: { bookingId: input.bookingId, intentDigest, commandDigest: digest(input) },
          });
        }
        const attempt = existing
          ? await tx.invitationMediaUploadAttempt.findFirst({
              where: { bookingId: input.bookingId, intentKeyDigest: receiptKey },
              orderBy: { sequence: 'desc' },
            })
          : null;
        if (existing && (!attempt || !this.media.storage.read)) throw pending();
        return { recover: existing !== null, attempt, policyRevision: policy.revision };
      },
      async (prepared, lease) => {
        let outputValidated = false;
        try {
          const output = prepared.recover
            ? await studioPhase(context, 'ai.generate', 'read', async () => {
                if (!prepared.attempt || !this.media.storage.read) throw pending();
                const attempt = prepared.attempt;
                const bytes = await this.media.storage
                  .read(
                    createStorageObjectReference({
                      objectKey: attempt.objectKey,
                      purpose: 'PRIVATE_WEDDING_MEDIA',
                      resourceId: input.bookingId,
                    }),
                  )
                  .catch((error: unknown) => {
                    if (error instanceof NotFoundError) throw pending();
                    throw error;
                  });
                const image = createGeneratedAiImage(bytes, 'image/png');
                if (
                  image.sizeBytes !== attempt.sizeBytes ||
                  createHash('sha256').update(bytes).digest('hex') !== attempt.checksumSha256
                )
                  throw new ProviderError('failure');
                return image;
              })
            : await studioPhase(context, 'ai.generate', 'provider', () => {
                requireActiveStudioRequest();
                return this.provider!.generate({
                  prompt: input.prompt,
                  aspectRatio: input.aspectRatio,
                });
              });
          const image = createGeneratedAiImage(output.bytes, output.contentType);
          await studioPhase(context, 'ai.generate', 'decode', async () => {
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
          });
          outputValidated = true;
          const expected = createStoredObject({
            bytes: image.bytes,
            contentType: 'image/png',
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId: input.bookingId,
          });
          const uploadDigest = createHash('sha256')
            .update(
              JSON.stringify({
                action: 'upload',
                bookingId: input.bookingId,
                bytes: expected.checksumSha256,
                contentType: 'image/png',
                altText: 'AI invitation artwork',
                idempotencyKey: uploadKey,
              }),
            )
            .digest('hex');
          const attempt = await lease.write(async (tx) => {
            const intent = await tx.invitationGenerationIntent.findUniqueOrThrow({
              where: intentWhere,
            });
            if (intent.status !== 'PENDING')
              throw studioConflict('AI_GENERATION_RECONCILIATION_STALE');
            await tx.invitationMediaCommand.createMany({
              data: {
                bookingId: input.bookingId,
                intentKeyDigest: receiptKey,
                commandDigest: uploadDigest,
              },
              skipDuplicates: true,
            });
            const bound = await tx.invitationMediaCommand.findUniqueOrThrow({
              where: {
                bookingId_intentKeyDigest: {
                  bookingId: input.bookingId,
                  intentKeyDigest: receiptKey,
                },
              },
            });
            if (bound.commandDigest !== uploadDigest) throw new IdempotencyKeyReusedError();
            return tx.invitationMediaUploadAttempt.create({
              data: {
                id: randomUUID(),
                bookingId: input.bookingId,
                objectKey: expected.objectKey,
                checksumSha256: expected.checksumSha256,
                contentType: expected.contentType,
                sizeBytes: expected.sizeBytes,
                intentKeyDigest: receiptKey,
                commandDigest: uploadDigest,
                policyRevision: prepared.policyRevision,
                createdAt: this.media.now(),
              },
            });
          });
          // Retain a paid output even if the caller disconnected. A late caller
          // still cannot accept it; a same-key retry may recover the journaled image.
          const stored = await studioPhase(context, 'ai.generate', 'upload', () =>
            this.media.storage.put({
              bytes: image.bytes,
              contentType: 'image/png',
              purpose: 'PRIVATE_WEDDING_MEDIA',
              resourceId: input.bookingId,
            }),
          );
          if (
            stored.objectKey !== expected.objectKey ||
            stored.checksumSha256 !== expected.checksumSha256 ||
            stored.sizeBytes !== expected.sizeBytes ||
            stored.contentType !== expected.contentType ||
            stored.resourceId !== input.bookingId ||
            stored.purpose !== expected.purpose
          )
            throw new ProviderError('failure');
          return { image, object: expected, attempt, uploadDigest, token: lease.token };
        } catch (error) {
          if (
            !prepared.recover &&
            !outputValidated &&
            error instanceof AppError &&
            [409, 422, 502].includes(error.status)
          ) {
            await lease.write((tx) =>
              tx.invitationGenerationIntent.updateMany({
                where: { bookingId: input.bookingId, intentDigest, status: 'PENDING' },
                data: { status: 'FAILED', errorCode: error.code, errorStatus: error.status },
              }),
            );
          }
          throw error;
        }
      },
      async (tx, scoped, output, prepared) => {
        const intent = await tx.invitationGenerationIntent.findUniqueOrThrow({
          where: intentWhere,
        });
        if (intent.status !== 'PENDING') throw studioConflict('AI_GENERATION_RECONCILIATION_STALE');
        const policy = await this.uploadPolicy(tx, input.bookingId, eventStartAt);
        await checkMediaQuota(tx, input.bookingId, output.image.sizeBytes, output.token);
        const assetId = randomUUID(),
          fileId = randomUUID();
        await tx.invitationMediaAsset.create({
          data: {
            id: assetId,
            bookingId: input.bookingId,
            revision: 1,
            currentFileRevisionId: fileId,
          },
        });
        await tx.invitationMediaFile.create({
          data: {
            id: fileId,
            bookingId: input.bookingId,
            assetId,
            revision: 1,
            objectKey: output.object.objectKey,
            checksumSha256: output.object.checksumSha256,
            contentType: 'image/png',
            sizeBytes: output.object.sizeBytes,
            width: output.image.width,
            height: output.image.height,
            altText: 'AI invitation artwork',
            acceptedAt: this.media.now(),
            policyRevision: policy.revision,
            cutoffAt: policy.cutoffAt,
            uploadAttemptId: output.attempt.id,
          },
        });
        await tx.invitationMediaReceipt.create({
          data: {
            bookingId: input.bookingId,
            intentKeyDigest: receiptKey,
            commandDigest: output.uploadDigest,
            result: asJson({
              id: assetId,
              revision: 1,
              currentFileRevisionId: fileId,
              detachedAt: null,
            }),
          },
        });
        await tx.invitationMediaAudit.create({
          data: {
            bookingId: input.bookingId,
            action: 'media.created',
            actorId: context.actorId,
            requestId: context.requestId,
            occurredAt: this.media.now(),
            assetId,
            revision: 1,
          },
        });
        await tx.invitationGenerationIntent.update({
          where: intentWhere,
          data: { status: 'ACCEPTED', mediaAssetId: assetId },
        });
        await this.repository.audit(
          tx,
          scoped,
          prepared.recover ? 'invitation.image-generation-recovered' : 'invitation.image-generated',
          assetId,
          1,
        );
        return {
          mediaAssetId: assetId,
          revision: 1,
          detachedAt: null,
          previewPath: '/api/v1/bookings/' + input.bookingId + '/media/' + assetId,
        };
      },
      (prepared) => prepared.attempt?.sizeBytes ?? MAX_AI_IMAGE_BYTES,
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
        await tx.invitationImageJob.updateMany({
          where: {
            bookingId: input.bookingId,
            generationIntentDigest: input.intentDigest,
            status: 'RECOVERY_REQUIRED',
          },
          data: { status: 'FAILED', errorCode: 'AI_GENERATION_ABANDONED', prompt: null },
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
