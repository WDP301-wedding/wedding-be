import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { InvitationImageJob } from '../../../generated/prisma/client.js';
import { AppError, NotFoundError, RateLimitError } from '../../../core/errors/app-error.js';
import { createPrismaAuditRepository } from '../../../core/audit/audit.repository.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import { withRequestDeadline } from '../../../core/http/request-deadline.js';
import { generateAiImageCommandSchema } from '../../../integrations/ai-image/ai-image.schemas.js';
import { AiImageProviderDisabledError } from '../../../integrations/ai-image/ai-image-provider.js';
import { createInvitationJobActorReader } from '../../identity-access/authorization/invitation-job-actor.reader.js';
import { createResolvedMediaAccessGuard } from '../application/media-access.guard.js';
import { createMediaEventStartReader } from '../application/media-event-start.reader.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import { id, digest, parseStudio, studioConflict } from '../domain/studio-policy.js';
import { imageJobQuery, imageJobResult, imageJobView } from '../domain/image-jobs.js';
import { generationReconcileBody } from '../domain/generation-recovery.js';
import { asJson, contractContext } from './studio.repository.js';
import { StudioAuthorization } from './studio-authorization.js';
import { GenerationService } from './generation.service.js';
import { DerivedAssetsService } from './derived-assets.service.js';

const commandSchema = generateAiImageCommandSchema.safeExtend({
  bookingId: id,
  idempotencyKey: idempotencyKeySchema,
});
const activeStates = ['QUEUED', 'RUNNING', 'RECOVERY_REQUIRED'];
const inputLifetimeMs = 24 * 60 * 60 * 1000;
export const IMAGE_JOB_LEASE_MS = 180_000;
type Dependencies = {
  repository: GenerationService['repository'];
  access: StudioAuthorization;
  generation: GenerationService;
  derivedAssets: DerivedAssetsService;
  booking: Parameters<typeof createResolvedMediaAccessGuard>[1];
  timeline: Parameters<typeof createMediaEventStartReader>[0];
};

export class ImageJobsService {
  constructor(
    readonly deps: Dependencies,
    readonly now: () => Date,
    readonly enabled = true,
  ) {}

  private view(row: InvitationImageJob) {
    return imageJobView.parse({
      jobId: row.id,
      intentDigest: row.generationIntentDigest,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      statusPath: `/api/v1/bookings/${row.bookingId}/invitation-image-jobs/${row.id}`,
      retryAfterSeconds: ['QUEUED', 'RUNNING'].includes(row.status) ? 3 : null,
      result: row.status === 'SUCCEEDED' ? row.result : null,
      errorCode: row.errorCode,
    });
  }

  async enqueue(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(commandSchema, value);
    if (!this.enabled || !this.deps.generation.provider) throw new AiImageProviderDisabledError();
    const { repository, access } = this.deps;
    const bound = await repository.bindCommand(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'ai.enqueue', ...input },
      (ctx) => access.booking(input.bookingId, ctx, 'COUPLE'),
      { action: 'ai.enqueue' },
    );
    return repository.boundary.run(
      { bookingId: input.bookingId, context: contractContext(context) },
      async (scope) => {
        const tx = repository.boundary.requireScope(input.bookingId, scope);
        const scoped = { ...context, transactionScopeId: scope.transactionScopeId! };
        const actor = await access.bookingActor(input.bookingId, scoped, 'COUPLE');
        const prior = await tx.invitationImageJob.findUnique({
          where: { bookingId_intentDigest: bound },
        });
        if (prior) return this.view(prior);
        const policy = await tx.invitationMediaPolicy.findUnique({
          where: { bookingId: input.bookingId },
        });
        if (
          this.now().getTime() >=
          (
            policy?.cutoffAt ?? new Date(actor.eventStartAt.getTime() - MEDIA_LIMITS.cutoffLeadMs)
          ).getTime()
        )
          throw studioConflict('MEDIA_CUTOFF_REACHED');
        const active = await tx.invitationImageJob.count({
          where: { bookingId: input.bookingId, status: { in: activeStates } },
        });
        const daily = await tx.invitationImageJob.count({
          where: {
            bookingId: input.bookingId,
            createdAt: { gt: new Date(this.now().getTime() - inputLifetimeMs) },
          },
        });
        if (active >= 2 || daily >= 10) throw new RateLimitError(60);
        const identity = await this.deps.access.actor(scoped);
        const jobId = randomUUID();
        const row = await tx.invitationImageJob.create({
          data: {
            id: jobId,
            ...bound,
            actorId: context.actorId,
            sessionId: identity.sessionId,
            requestId: context.requestId,
            prompt: input.prompt,
            aspectRatio: input.aspectRatio,
            generationIntentDigest: digest({ actorId: context.actorId, key: jobId }),
            createdAt: this.now(),
            inputExpiresAt: new Date(this.now().getTime() + inputLifetimeMs),
          },
        });
        await repository.audit(tx, scoped, 'invitation.image-job-enqueued', jobId, 1);
        await access.booking(input.bookingId, scoped, 'COUPLE');
        return this.view(row);
      },
    );
  }

  async read(bookingValue: string, jobValue: string, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      jobId = parseStudio(id, jobValue);
    await this.deps.access.booking(bookingId, context);
    const row = await this.deps.repository.prisma.invitationImageJob.findFirst({
      where: { bookingId, id: jobId },
    });
    if (!row) throw new NotFoundError();
    await this.deps.access.booking(bookingId, context);
    return this.view(row);
  }

  async list(bookingValue: string, value: unknown, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      query = parseStudio(imageJobQuery, value);
    await this.deps.access.booking(bookingId, context);
    const table = this.deps.repository.prisma.invitationImageJob;
    const cursor = query.cursor
      ? await table.findFirst({ where: { bookingId, id: query.cursor } })
      : null;
    if (query.cursor && !cursor) throw new NotFoundError();
    const rows = await table.findMany({
      where: {
        bookingId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    await this.deps.access.booking(bookingId, context);
    return {
      items: rows.slice(0, query.limit).map((r) => this.view(r)),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
    };
  }

  async recover(bookingValue: string, jobValue: string, key: string, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      jobId = parseStudio(id, jobValue);
    if (!this.enabled) throw new AiImageProviderDisabledError();
    return this.deps.repository.command(
      bookingId,
      context,
      key,
      { jobId },
      (ctx) => this.deps.access.booking(bookingId, ctx),
      async (tx) => {
        const row = await tx.invitationImageJob.findFirst({ where: { bookingId, id: jobId } });
        if (!row) throw new NotFoundError();
        if (row.status !== 'RECOVERY_REQUIRED' || !row.prompt || row.inputExpiresAt <= this.now())
          throw studioConflict('AI_JOB_RECOVERY_UNAVAILABLE');
        const result = await tx.invitationImageJob.update({
          where: { id: jobId },
          data: { status: 'QUEUED', errorCode: null },
        });
        await this.deps.repository.audit(
          tx,
          context,
          'invitation.image-job-recovery-requested',
          jobId,
          1,
        );
        return this.view(result);
      },
      { action: 'ai.job-recover', resourceId: jobId },
    );
  }

  async abandon(
    bookingValue: string,
    jobValue: string,
    value: unknown,
    key: string,
    context: MediaRequestContext,
  ) {
    const bookingId = parseStudio(id, bookingValue),
      jobId = parseStudio(id, jobValue);
    const input = parseStudio(generationReconcileBody, value);
    return this.deps.repository.command(
      bookingId,
      context,
      key,
      { jobId, ...input },
      (ctx) => this.deps.access.booking(bookingId, ctx, 'MANAGER'),
      async (tx, scoped) => {
        const row = await tx.invitationImageJob.findFirst({ where: { id: jobId, bookingId } });
        if (!row) throw new NotFoundError();
        if (row.status !== 'RECOVERY_REQUIRED') throw studioConflict('AI_JOB_RECONCILIATION_STALE');
        // May be an unknown provider effect, a failed derive, or a crash before
        // dispatch. Preserve accepted assets and every intent/journal either way.
        await tx.invitationGenerationIntent.updateMany({
          where: { bookingId, intentDigest: row.generationIntentDigest, status: 'PENDING' },
          data: { status: 'FAILED', errorCode: 'AI_GENERATION_ABANDONED', errorStatus: 502 },
        });
        const result = await tx.invitationImageJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', errorCode: 'AI_JOB_ABANDONED', prompt: null },
        });
        await createPrismaAuditRepository(tx).append({
          occurredAt: this.now(),
          requestId: scoped.requestId,
          actorType: 'USER',
          actorId: scoped.actorId,
          action: 'invitation.image-job-abandoned',
          entityType: 'INVITATION',
          entityId: bookingId,
          metadata: {
            jobId,
            intentDigest: row.generationIntentDigest,
            outcome: input.outcome,
            evidenceReference: input.evidenceReference,
          },
        });
        return this.view(result);
      },
      { action: 'ai.job-abandon', resourceId: jobId },
    );
  }

  /** One DB admission lane across processes, with bounded ownership. An expired
   * generation resumes by the SAME job ID: durable intent prevents paid replay. */
  async runNext(logger?: Logger): Promise<boolean> {
    const { repository } = this.deps;
    // Runs even when paid dispatch is disabled; operational input has a bounded
    // lifetime. Terminal facts, digests and accepted assets are never erased.
    const expired = await repository.prisma.invitationImageJob.findMany({
      where: {
        prompt: { not: null },
        inputExpiresAt: { lte: this.now() },
        OR: [{ status: { not: 'RUNNING' } }, { claimExpiresAt: { lte: this.now() } }],
      },
      select: { id: true, status: true },
      take: 20,
    });
    for (const row of expired)
      await repository.prisma.invitationImageJob.updateMany({
        where: {
          id: row.id,
          status: row.status,
          prompt: { not: null },
          inputExpiresAt: { lte: this.now() },
          OR: [{ status: { not: 'RUNNING' } }, { claimExpiresAt: { lte: this.now() } }],
        },
        data: {
          prompt: null,
          status:
            row.status === 'QUEUED'
              ? 'FAILED'
              : row.status === 'RUNNING'
                ? 'RECOVERY_REQUIRED'
                : row.status,
          errorCode: 'AI_JOB_INPUT_EXPIRED',
          claimToken: null,
          claimExpiresAt: null,
        },
      });
    if (!this.enabled) return false;
    const job = await repository.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext('invitation-image-job-dispatch')) AS acquired`;
      if (!lock?.acquired) return null;
      if (
        await tx.invitationImageJob.count({
          where: { status: 'RUNNING', claimExpiresAt: { gt: this.now() } },
        })
      )
        return null;
      const row = await tx.invitationImageJob.findFirst({
        where: {
          OR: [{ status: 'QUEUED' }, { status: 'RUNNING', claimExpiresAt: { lte: this.now() } }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!row) return null;
      return tx.invitationImageJob.update({
        where: { id: row.id },
        data: {
          status: 'RUNNING',
          errorCode: null,
          claimToken: randomUUID(),
          claimExpiresAt: new Date(this.now().getTime() + IMAGE_JOB_LEASE_MS),
        },
      });
    });
    if (!job) return false;
    const update = (
      data: Parameters<typeof repository.prisma.invitationImageJob.updateMany>[0]['data'],
    ) =>
      repository.prisma.invitationImageJob.updateMany({
        where: { id: job.id, claimToken: job.claimToken, status: 'RUNNING' },
        data: { ...data, claimToken: null, claimExpiresAt: null },
      });
    try {
      if (!job.prompt || job.inputExpiresAt <= this.now()) {
        await update({ status: 'FAILED', errorCode: 'AI_JOB_INPUT_EXPIRED', prompt: null });
        return true;
      }
      const context: MediaRequestContext = {
        actorId: job.actorId,
        requestId: job.requestId,
        ...(logger ? { logger } : {}),
      };
      const actor = createInvitationJobActorReader(
        repository.prisma,
        repository.boundary,
        this.now,
      );
      const guard = createResolvedMediaAccessGuard(
        async (ctx) => {
          const current = await actor(job.actorId, job.sessionId);
          if (ctx.actorId !== job.actorId) throw new NotFoundError();
          const db = repository.boundary.current() ?? repository.prisma;
          const fenced = await db.invitationImageJob.updateMany({
            where: {
              id: job.id,
              status: 'RUNNING',
              claimToken: job.claimToken,
              claimExpiresAt: { gt: this.now() },
            },
            data: { updatedAt: this.now() },
          });
          if (fenced.count !== 1) throw studioConflict('AI_JOB_LEASE_LOST');
          return current;
        },
        this.deps.booking,
        createMediaEventStartReader(this.deps.timeline),
      );
      const access = new StudioAuthorization(
        {
          requireAccess: (bookingId, ctx) => {
            if (bookingId !== job.bookingId) throw new NotFoundError();
            return guard.requireAccess(bookingId, ctx);
          },
        },
        this.deps.access.editor,
      );
      const generation = new GenerationService(
        repository,
        access,
        this.deps.generation.media,
        this.deps.generation.provider,
      );
      const derived = new DerivedAssetsService(repository, access, this.deps.derivedAssets.storage);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 110_000);
      timeout.unref();
      try {
        const result = await withRequestDeadline(
          { signal: controller.signal, expiresAt: performance.now() + 110_000 },
          async () => {
            const media = await generation.generate(
              {
                bookingId: job.bookingId,
                prompt: job.prompt,
                aspectRatio: job.aspectRatio,
                idempotencyKey: job.id,
              },
              context,
            );
            const asset = await derived.derive(
              {
                bookingId: job.bookingId,
                mediaAssetId: media.mediaAssetId,
                expectedRevision: media.revision,
                idempotencyKey: job.id + ':derive',
              },
              context,
            );
            return imageJobResult.parse({
              mediaAssetId: media.mediaAssetId,
              derivedAssetId: asset.derivedAssetId,
              previewPath: media.previewPath,
            });
          },
        );
        const completed = await update({
          status: 'SUCCEEDED',
          result: asJson(result),
          prompt: null,
          errorCode: null,
        });
        if (completed.count)
          logger?.info(
            { event: 'invitation_image_job_completed', jobId: job.id, status: 'SUCCEEDED' },
            'Image job completed',
          );
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AI_JOB_INTERRUPTED';
      const knownProviderFailure =
        error instanceof AppError && error.status === 502
          ? (
              await repository.prisma.invitationGenerationIntent.findUnique({
                where: {
                  bookingId_intentDigest: {
                    bookingId: job.bookingId,
                    intentDigest: job.generationIntentDigest,
                  },
                },
              })
            )?.status === 'FAILED'
          : false;
      const terminal =
        error instanceof AppError &&
        ([401, 403, 404, 409, 422].includes(error.status) || knownProviderFailure) &&
        !['REQUEST_IN_PROGRESS', 'AI_JOB_LEASE_LOST'].includes(code);
      const completed = await update({
        status: terminal ? 'FAILED' : 'RECOVERY_REQUIRED',
        errorCode: code,
        ...(terminal ? { prompt: null } : {}),
      });
      if (completed.count)
        logger?.warn(
          {
            event: 'invitation_image_job_completed',
            jobId: job.id,
            status: terminal ? 'FAILED' : 'RECOVERY_REQUIRED',
            errorCode: code,
          },
          'Image job needs attention',
        );
    }
    return true;
  }
}
