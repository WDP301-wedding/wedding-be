import { createHash, randomUUID } from 'node:crypto';
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
  NotFoundError,
  RequestInProgressError,
  ValidationError,
} from '../../../core/errors/app-error.js';
import { claimMediaQuota, MEDIA_LIMITS, mediaConflict } from '../domain/media-policy.js';
import type {
  MediaAsset,
  MediaAuditFact,
  MediaCommandIdentity,
  MediaFileRevision,
  MediaPolicy,
  MediaRepository,
  MediaRequestContext,
  MediaState,
  MediaUploadAttempt,
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
      const [policy, assets, receipts, reservations] = await Promise.all([
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
        tx.invitationExternalWork.aggregate({
          where: { bookingId, expiresAt: { gt: new Date() } },
          _sum: { reservedFiles: true, reservedBytes: true },
        }),
      ]);
      if (assets.length > MEDIA_LIMITS.activeFiles)
        throw new Error('Persisted active media exceeds quota.');
      const files = assets.map((a) => a.currentFile);
      const state: MediaState = {
        reservedFiles: reservations._sum.reservedFiles ?? 0,
        reservedBytes: reservations._sum.reservedBytes ?? 0,
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
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}::text))`;
        return accept(tx, context);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  async previewAsset(
    bookingId: string,
    assetId: string,
    context?: MediaRequestContext,
    authorize?: (scopedContext: MediaRequestContext) => Promise<void>,
  ): Promise<{
    readonly asset: MediaAsset;
    readonly file: MediaFileRevision;
    readonly policy: MediaPolicy | null;
  }> {
    bookingId = z.uuid().parse(bookingId).toLowerCase();
    assetId = z.uuid().parse(assetId).toLowerCase();
    const read = async (tx: Prisma.TransactionClient) => {
      const asset = await tx.invitationMediaAsset.findFirst({
        where: { bookingId, id: assetId, detachedAt: null },
        include: { currentFile: true },
      });
      if (asset === null || asset.currentFile === null) throw new NotFoundError();
      const policy = await tx.invitationMediaPolicy.findUnique({ where: { bookingId } });
      const f = asset.currentFile;
      return {
        asset: {
          id: asset.id,
          revision: asset.revision,
          currentFileRevisionId: asset.currentFileRevisionId,
          detachedAt: asset.detachedAt?.toISOString() ?? null,
        },
        file: {
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
        policy:
          policy === null
            ? null
            : { revision: policy.revision, cutoffAt: policy.cutoffAt.toISOString() },
      };
    };
    if (this.boundary !== undefined && context !== undefined) {
      return this.boundary.runRead(
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
        async (scoped) => {
          if (authorize !== undefined) {
            await authorize({
              ...context,
              ...(scoped.transactionScopeId !== undefined
                ? { transactionScopeId: scoped.transactionScopeId }
                : {}),
            });
          }
          return read(this.boundary!.current(bookingId)!);
        },
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${bookingId}::text))`;
        if (authorize !== undefined && context !== undefined) {
          await authorize(context);
        }
        return read(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 10_000,
      },
    );
  }

  async claimUploadLease(
    input: {
      bookingId: string;
      bytes: number;
      assetId?: string;
      expectedRevision?: number;
      idempotencyKey: string;
      commandDigest: string;
      intentKeyDigest: string;
      object: StoredObject;
      cutoffAt?: string;
    },
    context: MediaRequestContext,
  ): Promise<
    | { readonly replay: true; readonly asset: MediaAsset }
    | {
        readonly replay: false;
        readonly leaseToken: string;
        readonly uploadAttemptId: string;
        readonly policyRevision: number;
        readonly cutoffAt: string;
        readonly prior?: MediaAsset;
      }
  > {
    const bookingId = z.uuid().parse(input.bookingId).toLowerCase();
    const hash = z.string().regex(/^[a-f0-9]{64}$/u);
    hash.parse(input.intentKeyDigest);
    hash.parse(input.commandDigest);

    // 1. Independent durable binding before the acceptance transaction/decoder.
    await this.prisma.invitationMediaCommand.createMany({
      data: {
        bookingId,
        intentKeyDigest: input.intentKeyDigest,
        commandDigest: input.commandDigest,
      },
      skipDuplicates: true,
    });
    const bound = await this.prisma.invitationMediaCommand.findUniqueOrThrow({
      where: {
        bookingId_intentKeyDigest: { bookingId, intentKeyDigest: input.intentKeyDigest },
      },
    });
    if (bound.commandDigest !== input.commandDigest) throw new IdempotencyKeyReusedError();

    const admit = async (tx: Prisma.TransactionClient) => {
      const [lock] = await tx.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`media-command:${bookingId}:${input.intentKeyDigest}`}, 0)) AS acquired`;
      if (lock?.acquired !== true) throw new RequestInProgressError(1);
    };

    const runClaim = async (
      tx: Prisma.TransactionClient,
    ): Promise<
      | { readonly replay: true; readonly asset: MediaAsset }
      | {
          readonly replay: false;
          readonly leaseToken: string;
          readonly uploadAttemptId: string;
          readonly policyRevision: number;
          readonly cutoffAt: string;
          readonly prior?: MediaAsset;
        }
    > => {
      // Replay check
      const [receipt] = await tx.invitationMediaReceipt.findMany({
        where: { bookingId, intentKeyDigest: input.intentKeyDigest },
        take: 1,
      });
      if (receipt !== undefined) {
        if (receipt.commandDigest !== input.commandDigest) {
          throw new IdempotencyKeyReusedError();
        }
        return { replay: true as const, asset: receipt.result as unknown as MediaAsset };
      }

      const priorAttempt = await tx.invitationMediaUploadAttempt.findFirst({
        where: { bookingId, intentKeyDigest: input.intentKeyDigest },
      });
      if (priorAttempt !== null && priorAttempt.commandDigest !== input.commandDigest) {
        throw new IdempotencyKeyReusedError();
      }

      // Check in-flight lease
      const activeLease = await tx.invitationExternalWork.findUnique({
        where: { bookingId_intentDigest: { bookingId, intentDigest: input.intentKeyDigest } },
      });
      if (activeLease && activeLease.expiresAt.getTime() > Date.now()) {
        throw new RequestInProgressError(1);
      }

      let assetLeaseDigest: string | undefined;
      if (input.assetId !== undefined) {
        assetLeaseDigest = createHash('sha256')
          .update(`replace:${bookingId}:${input.assetId}`)
          .digest('hex');
        const activeAssetLease = await tx.invitationExternalWork.findUnique({
          where: { bookingId_intentDigest: { bookingId, intentDigest: assetLeaseDigest } },
        });
        if (activeAssetLease && activeAssetLease.expiresAt.getTime() > Date.now()) {
          throw mediaConflict('MEDIA_REVISION_STALE');
        }
      }

      let policy = await tx.invitationMediaPolicy.findUnique({ where: { bookingId } });
      if (policy === null && input.cutoffAt !== undefined) {
        policy = await tx.invitationMediaPolicy.create({
          data: {
            bookingId,
            revision: 0,
            cutoffAt: new Date(input.cutoffAt),
          },
        });
      }

      let prior: MediaAsset | undefined;
      if (input.assetId !== undefined) {
        const row = await tx.invitationMediaAsset.findFirst({
          where: { bookingId, id: input.assetId, detachedAt: null },
        });
        if (row === null) throw new NotFoundError();
        if (row.revision !== input.expectedRevision) throw mediaConflict('MEDIA_REVISION_STALE');
        prior = {
          id: row.id,
          revision: row.revision,
          currentFileRevisionId: row.currentFileRevisionId,
          detachedAt: row.detachedAt?.toISOString() ?? null,
        };
      }

      const assets = await tx.invitationMediaAsset.findMany({
        where: { bookingId, detachedAt: null },
        include: { currentFile: true },
        take: MEDIA_LIMITS.activeFiles + 1,
      });
      if (assets.length > MEDIA_LIMITS.activeFiles)
        throw new Error('Persisted active media exceeds quota.');

      const files = assets.map((a) => a.currentFile);

      const reservations = await tx.invitationExternalWork.aggregate({
        where: {
          bookingId,
          expiresAt: { gt: new Date() },
          ...(activeLease ? { token: { not: activeLease.token } } : {}),
        },
        _sum: { reservedFiles: true, reservedBytes: true },
      });

      const state: MediaState = {
        reservedFiles: reservations._sum.reservedFiles ?? 0,
        reservedBytes: reservations._sum.reservedBytes ?? 0,
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
        receipts: new Map(),
        audit: [],
      };

      claimMediaQuota(state, input.bytes, prior?.id);

      const leaseToken = randomUUID();
      const uploadAttemptId = randomUUID();
      const policyRevision = policy?.revision ?? 0;
      const cutoffAt = policy?.cutoffAt.toISOString() ?? input.cutoffAt;
      if (cutoffAt === undefined) throw new ValidationError();

      await tx.invitationExternalWork.upsert({
        where: { bookingId_intentDigest: { bookingId, intentDigest: input.intentKeyDigest } },
        create: {
          bookingId,
          intentDigest: input.intentKeyDigest,
          token: leaseToken,
          expiresAt: new Date(Date.now() + 120_000),
          reservedFiles: prior ? 0 : 1,
          reservedBytes: input.bytes,
        },
        update: {
          token: leaseToken,
          expiresAt: new Date(Date.now() + 120_000),
          reservedFiles: prior ? 0 : 1,
          reservedBytes: input.bytes,
        },
      });

      if (assetLeaseDigest !== undefined) {
        await tx.invitationExternalWork.upsert({
          where: { bookingId_intentDigest: { bookingId, intentDigest: assetLeaseDigest } },
          create: {
            bookingId,
            intentDigest: assetLeaseDigest,
            token: randomUUID(),
            expiresAt: new Date(Date.now() + 120_000),
            reservedFiles: 0,
            reservedBytes: 0,
          },
          update: {
            expiresAt: new Date(Date.now() + 120_000),
          },
        });
      }

      return {
        replay: false as const,
        leaseToken,
        uploadAttemptId,
        policyRevision,
        cutoffAt,
        ...(prior === undefined ? {} : { prior }),
      };
    };

    if (this.boundary !== undefined) {
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
        (scoped) => runClaim(this.boundary!.requireScope(bookingId, scoped)),
        admit,
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await admit(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}::text))`;
        return runClaim(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 10_000,
      },
    );
  }

  async acceptUpload(
    input: {
      bookingId: string;
      leaseToken: string;
      intentKeyDigest: string;
      commandDigest: string;
      uploadAttemptId: string;
      prior?: MediaAsset;
      object: StoredObject;
      dimensions: { width: number; height: number };
      altText: string;
      policyRevision: number;
      cutoffAt: string;
    },
    context: MediaRequestContext,
    authorize?: (scopedContext: MediaRequestContext) => Promise<void>,
  ): Promise<MediaAsset> {
    const bookingId = z.uuid().parse(input.bookingId).toLowerCase();

    const admit = async (tx: Prisma.TransactionClient) => {
      const [lock] = await tx.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`media-command:${bookingId}:${input.intentKeyDigest}`}, 0)) AS acquired`;
      if (lock?.acquired !== true) throw new RequestInProgressError(1);
    };

    const runAccept = async (
      tx: Prisma.TransactionClient,
      scopedContext?: MediaRequestContext,
    ) => {
      if (authorize !== undefined && scopedContext !== undefined) {
        await authorize(scopedContext);
      }
      if (Date.now() >= new Date(input.cutoffAt).getTime()) {
        throw mediaConflict('MEDIA_CUTOFF_REACHED');
      }

      // Replay check
      const receipt = await tx.invitationMediaReceipt.findUnique({
        where: { bookingId_intentKeyDigest: { bookingId, intentKeyDigest: input.intentKeyDigest } },
      });
      if (receipt) return receipt.result as unknown as MediaAsset;

      // Verify lease
      const claim = await tx.invitationExternalWork.findUnique({
        where: { bookingId_intentDigest: { bookingId, intentDigest: input.intentKeyDigest } },
      });
      if (!claim || claim.token !== input.leaseToken || claim.expiresAt.getTime() <= Date.now()) {
        throw new RequestInProgressError(1);
      }

      // Re-verify prior if replacing
      if (input.prior !== undefined) {
        const current = await tx.invitationMediaAsset.findFirst({
          where: { bookingId, id: input.prior.id, detachedAt: null },
        });
        if (current === null || current.revision !== input.prior.revision) {
          throw mediaConflict('MEDIA_REVISION_STALE');
        }
      }

      const id = input.prior?.id ?? randomUUID();
      const fileId = randomUUID();
      const revision = (input.prior?.revision ?? 0) + 1;
      const acceptedAt = new Date();

      if (input.prior !== undefined) {
        await tx.invitationMediaAsset.update({
          where: { id },
          data: { revision, currentFileRevisionId: fileId },
        });
      } else {
        await tx.invitationMediaAsset.create({
          data: {
            id,
            bookingId,
            revision,
            currentFileRevisionId: fileId,
          },
        });
      }

      await tx.invitationMediaFile.create({
        data: {
          id: fileId,
          bookingId,
          assetId: id,
          revision,
          objectKey: input.object.objectKey,
          checksumSha256: input.object.checksumSha256,
          contentType: input.object.contentType,
          sizeBytes: input.object.sizeBytes,
          width: input.dimensions.width,
          height: input.dimensions.height,
          altText: input.altText,
          acceptedAt,
          policyRevision: input.policyRevision,
          cutoffAt: new Date(input.cutoffAt),
          uploadAttemptId: input.uploadAttemptId,
        },
      });

      const asset: MediaAsset = {
        id,
        revision,
        currentFileRevisionId: fileId,
        detachedAt: null,
      };

      await tx.invitationMediaReceipt.create({
        data: {
          bookingId,
          intentKeyDigest: input.intentKeyDigest,
          commandDigest: input.commandDigest,
          result: asset as unknown as Prisma.InputJsonValue,
        },
      });

      await appendAudit(tx, bookingId, {
        action: input.prior === undefined ? 'media.created' : 'media.replaced',
        actorId: context.actorId,
        requestId: context.requestId,
        occurredAt: acceptedAt.toISOString(),
        assetId: id,
        revision,
      });

      // Release lease
      const digestsToDelete = [input.intentKeyDigest];
      if (input.prior !== undefined) {
        digestsToDelete.push(
          createHash('sha256').update(`replace:${bookingId}:${input.prior.id}`).digest('hex'),
        );
      }
      await tx.invitationExternalWork.deleteMany({
        where: { bookingId, intentDigest: { in: digestsToDelete } },
      });

      return asset;
    };

    if (this.boundary !== undefined) {
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
          runAccept(this.boundary!.requireScope(bookingId, scoped), {
            ...context,
            transactionScopeId: scoped.transactionScopeId!,
          }),
        admit,
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        await admit(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bookingId}::text))`;
        return runAccept(tx, context);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 10_000,
      },
    );
  }

  async releaseUploadLease(
    bookingId: string,
    intentKeyDigest: string,
    leaseToken?: string,
  ): Promise<void> {
    bookingId = z.uuid().parse(bookingId).toLowerCase();
    await this.prisma.invitationExternalWork
      .deleteMany({
        where: {
          bookingId,
          OR: [
            { intentDigest: intentKeyDigest },
            ...(leaseToken !== undefined ? [{ token: leaseToken }] : []),
          ],
        },
      })
      .catch(() => undefined);
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
    const receipts = await this.prisma.invitationMediaReceipt.findMany({
      where: {
        bookingId,
        intentKeyDigest: { in: attempts.map((a) => a.intentKeyDigest) },
      },
    });
    const receiptMap = new Map(receipts.map((r) => [r.intentKeyDigest, r]));
    return attempts.map((a) => {
      const receipt = receiptMap.get(a.intentKeyDigest);
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
    });
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
