import { z } from 'zod';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  createStorageObjectReference,
  type StoredObject,
} from '../../../integrations/storage/storage-provider.js';
import { storageContentTypeSchema } from '../../../integrations/storage/storage.schemas.js';
import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
} from '../../../core/errors/app-error.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import type {
  MediaAuditFact,
  MediaRepository,
  MediaRequestContext,
  MediaState,
  MediaUploadAttempt,
  MediaCommandIdentity,
} from '../application/media.contracts.js';

const assetSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  currentFileRevisionId: z.uuid(),
  detachedAt: z.iso.datetime().nullable(),
});
const resultSchema = z.union([
  assetSchema,
  z.strictObject({ revision: z.number().int().nonnegative(), cutoffAt: z.iso.datetime() }),
]);

/** Persistent owner adapter. The separate journal operation requires an available
 * second pool connection and commits before Storage.put, outside acceptance rollback.
 * Shared Booking/Identity scopes must enlist their real guards before runtime wiring. */
export class PrismaMediaRepository implements MediaRepository {
  constructor(
    readonly prisma: PrismaClient,
    readonly boundary?: PrismaBookingBoundary,
  ) {}

  async runLocked<T>(
    bookingId: string,
    work: (state: MediaState, scopedContext?: MediaRequestContext) => Promise<T>,
    command?: MediaCommandIdentity,
    context?: MediaRequestContext,
  ): Promise<T> {
    bookingId = z.uuid().parse(bookingId).toLowerCase();
    if (command !== undefined) {
      const hash = z.string().regex(/^[a-f0-9]{64}$/u);
      hash.parse(command.intentKeyDigest);
      hash.parse(command.commandDigest);
      // Independent durable binding BEFORE the acceptance transaction/decoder.
      // Concurrent mismatched bodies observe the persisted digest, not only a lock.
      await this.prisma.invitationMediaCommand.createMany({
        data: { bookingId, ...command },
        skipDuplicates: true,
      });
      const bound = await this.prisma.invitationMediaCommand.findUniqueOrThrow({
        where: {
          bookingId_intentKeyDigest: { bookingId, intentKeyDigest: command.intentKeyDigest },
        },
      });
      if (bound.commandDigest !== command.commandDigest) throw new IdempotencyKeyReusedError();
    }
    const admit = async (tx: Prisma.TransactionClient) => {
      if (command !== undefined) {
        const [lock] = await tx.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`media-command:${bookingId}:${command.intentKeyDigest}`}, 0)) AS acquired`;
        if (lock?.acquired !== true) throw new RequestInProgressError(1);
      }
    };
    const accept = async (tx: Prisma.TransactionClient, scopedContext?: MediaRequestContext) => {
      const [policy, assets, receipts] = await Promise.all([
        tx.invitationMediaPolicy.findUnique({ where: { bookingId } }),
        tx.invitationMediaAsset.findMany({
          where: { bookingId, detachedAt: null },
          include: { currentFile: true },
          take: MEDIA_LIMITS.activeFiles + 1,
        }),
        command === undefined
          ? Promise.resolve([])
          : tx.invitationMediaReceipt.findMany({
              where: { bookingId, intentKeyDigest: command.intentKeyDigest },
              take: 1,
            }),
      ]);
      if (assets.length > MEDIA_LIMITS.activeFiles)
        throw new Error('Persisted active media exceeds quota.');
      const files = assets.map((a) => a.currentFile);
      const state: MediaState = {
        policy:
          policy === null
            ? null
            : { revision: policy.revision, cutoffAt: policy.cutoffAt.toISOString() },
        assets: new Map(
          assets.map((a) => [
            a.id,
            {
              id: a.id,
              revision: a.revision,
              currentFileRevisionId: a.currentFileRevisionId,
              detachedAt: a.detachedAt?.toISOString() ?? null,
            },
          ]),
        ),
        files: new Map(
          files.map((f) => [
            f.id,
            {
              id: f.id,
              assetId: f.assetId,
              revision: f.revision,
              object: stored(f),
              width: f.width,
              height: f.height,
              altText: f.altText,
              acceptedAt: f.acceptedAt.toISOString(),
              policyRevision: f.policyRevision,
              cutoffAt: f.cutoffAt.toISOString(),
              uploadAttemptId: f.uploadAttemptId,
            },
          ]),
        ),
        receipts: new Map(
          receipts.map((r) => [
            r.intentKeyDigest,
            { digest: r.commandDigest, result: resultSchema.parse(r.result) },
          ]),
        ),
        audit: [],
      };
      const before = structuredClone(state);
      const result = await work(state, scopedContext);
      if (state.policy !== null && JSON.stringify(state.policy) !== JSON.stringify(before.policy)) {
        await tx.invitationMediaPolicy.upsert({
          where: { bookingId },
          create: {
            bookingId,
            revision: state.policy.revision,
            cutoffAt: new Date(state.policy.cutoffAt),
          },
          update: { revision: state.policy.revision, cutoffAt: new Date(state.policy.cutoffAt) },
        });
      }
      for (const asset of state.assets.values()) {
        if (JSON.stringify(asset) === JSON.stringify(before.assets.get(asset.id))) continue;
        const data = {
          bookingId,
          revision: asset.revision,
          currentFileRevisionId: asset.currentFileRevisionId,
          detachedAt: asset.detachedAt === null ? null : new Date(asset.detachedAt),
        };
        await tx.invitationMediaAsset.upsert({
          where: { id: asset.id },
          create: { id: asset.id, ...data },
          update: data,
        });
      }
      for (const file of state.files.values()) {
        if (before.files.has(file.id)) {
          if (JSON.stringify(file) !== JSON.stringify(before.files.get(file.id)))
            throw new Error('Immutable media file changed.');
          continue;
        }
        await tx.invitationMediaFile.create({
          data: {
            id: file.id,
            bookingId,
            assetId: file.assetId,
            revision: file.revision,
            objectKey: file.object.objectKey,
            checksumSha256: file.object.checksumSha256,
            contentType: file.object.contentType,
            sizeBytes: file.object.sizeBytes,
            width: file.width,
            height: file.height,
            altText: file.altText,
            acceptedAt: new Date(file.acceptedAt),
            cutoffAt: new Date(file.cutoffAt),
            policyRevision: file.policyRevision,
            uploadAttemptId: file.uploadAttemptId,
          },
        });
      }
      for (const [intentKeyDigest, receipt] of state.receipts) {
        if (before.receipts.has(intentKeyDigest)) continue;
        const resultJson = resultSchema.parse(receipt.result);
        await tx.invitationMediaReceipt.create({
          data: { bookingId, intentKeyDigest, commandDigest: receipt.digest, result: resultJson },
        });
      }
      for (const fact of state.audit.slice(before.audit.length))
        await appendAudit(tx, bookingId, fact);
      return result;
    };
    if (this.boundary !== undefined) {
      if (context === undefined) throw new Error('Media boundary requires authenticated context.');
      return this.boundary.run(
        {
          bookingId,
          context: {
            requestId: context.requestId,
            causationId: context.causationId ?? context.requestId,
            actorAccountId: context.actorId,
            authority: 'AUTHENTICATED',
            ...(context.transactionScopeId === undefined
              ? {}
              : { transactionScopeId: context.transactionScopeId }),
          },
        },
        (scoped) =>
          accept(this.boundary!.requireScope(bookingId, scoped), {
            ...context,
            transactionScopeId: scoped.transactionScopeId!,
          }),
        admit,
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await admit(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || ${bookingId}::text, 0))`;
        return accept(tx, context);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  async recordUploadAttempt(attempt: MediaUploadAttempt): Promise<void> {
    await this.prisma.invitationMediaUploadAttempt.create({
      data: {
        id: attempt.id,
        bookingId: attempt.bookingId,
        objectKey: attempt.object.objectKey,
        checksumSha256: attempt.object.checksumSha256,
        contentType: attempt.object.contentType,
        sizeBytes: attempt.object.sizeBytes,
        intentKeyDigest: attempt.intentKeyDigest,
        commandDigest: attempt.commandDigest,
        createdAt: new Date(attempt.createdAt),
        policyRevision: attempt.policyRevision,
      },
    });
  }

  async recordDeniedAccess(bookingId: string, context: MediaRequestContext): Promise<void> {
    await this.prisma.invitationMediaAudit.create({
      data: {
        bookingId,
        action: 'media.access-denied',
        actorId: context.actorId,
        requestId: context.requestId,
        occurredAt: new Date(),
        assetId: null,
        revision: 0,
      },
    });
  }

  /** Privileged read-only reconciliation; never deletes an original. Bounded page
   * uses insertion sequence ordering, and caller retains the last attempt ID as cursor.
   * Repeat full sweeps to reconcile transactions that committed out of order. */
  async recoveryPage(bookingId: string, limit: number, afterId?: string) {
    z.uuid().parse(bookingId);
    z.number().int().min(1).max(100).parse(limit);
    if (afterId !== undefined) z.uuid().parse(afterId);
    const after =
      afterId === undefined
        ? undefined
        : await this.prisma.invitationMediaUploadAttempt.findFirstOrThrow({
            where: { bookingId, id: afterId },
            select: { sequence: true },
          });
    const attempts = await this.prisma.invitationMediaUploadAttempt.findMany({
      where: { bookingId, ...(after === undefined ? {} : { sequence: { gt: after.sequence } }) },
      take: limit,
      orderBy: { sequence: 'asc' },
      include: { files: { select: { id: true }, take: 1 } },
    });
    return Promise.all(
      attempts.map(async (a) => {
        const receipt = await this.prisma.invitationMediaReceipt.findUnique({
          where: { bookingId_intentKeyDigest: { bookingId, intentKeyDigest: a.intentKeyDigest } },
        });
        return {
          attemptId: a.id,
          object: stored(a),
          outcome:
            a.files.length > 0
              ? ('ACCEPTED' as const)
              : receipt?.commandDigest === a.commandDigest
                ? ('REPLAY_RECONCILED' as const)
                : ('UNRESOLVED' as const),
        };
      }),
    );
  }

  /** Each sweep deliberately starts from the beginning. A sequence allocated by a
   * late-committing journal transaction is found on the next sweep; no durable
   * high-water cursor can permanently hide it. Caller controls retries/scheduling. */
  async *recoverySweep(bookingId: string, pageSize = 100) {
    let afterId: string | undefined;
    for (;;) {
      const page = await this.recoveryPage(bookingId, pageSize, afterId);
      if (page.length === 0) return;
      yield page;
      afterId = page.at(-1)!.attemptId;
    }
  }
}

function stored(row: {
  readonly bookingId: string;
  readonly objectKey: string;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}): StoredObject {
  return {
    ...createStorageObjectReference({
      objectKey: row.objectKey,
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId: row.bookingId,
    }),
    checksumSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parse(row.checksumSha256),
    contentType: storageContentTypeSchema.parse(row.contentType),
    sizeBytes: row.sizeBytes,
  };
}

async function appendAudit(
  tx: Prisma.TransactionClient,
  bookingId: string,
  fact: MediaAuditFact,
): Promise<void> {
  await tx.invitationMediaAudit.create({
    data: {
      bookingId,
      action: fact.action,
      actorId: fact.actorId,
      requestId: fact.requestId,
      occurredAt: new Date(fact.occurredAt),
      assetId: fact.assetId,
      revision: fact.revision,
      previousCutoffAt:
        fact.previousCutoffAt === undefined ? null : new Date(fact.previousCutoffAt),
      cutoffAt: fact.cutoffAt === undefined ? null : new Date(fact.cutoffAt),
    },
  });
}
