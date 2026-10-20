import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { RequestInProgressError, ValidationError } from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { MEDIA_LIMITS, mediaConflict } from '../domain/media-policy.js';
import { asJson, contractContext, type StudioRepository } from './studio.repository.js';
import { requireActiveStudioRequest, studioPhase } from './studio-phase.js';

type Transaction = Prisma.TransactionClient;
export interface ExternalLease {
  readonly token: string;
  write<T>(work: (tx: Transaction, context: MediaRequestContext) => Promise<T>): Promise<T>;
}
interface Command {
  bookingId: string;
  idempotencyKey: string;
  payload: unknown;
  operation: { action: 'ai.generate' | 'asset.derive'; resourceId?: string };
}

// Longer than the 60s HTTP budget, bounded so a crashed process cannot reserve
// quota forever. Expiration never grants permission to repeat paid generation.
export const EXTERNAL_WORK_LEASE_MS = 120_000;

export async function checkMediaQuota(
  tx: Transaction,
  bookingId: string,
  bytes: number,
  excludeToken?: string,
): Promise<void> {
  const assets = await tx.invitationMediaAsset.findMany({
    where: { bookingId, detachedAt: null },
    include: { currentFile: true },
    take: MEDIA_LIMITS.activeFiles + 1,
  });
  const reservations = await tx.invitationExternalWork.aggregate({
    where: {
      bookingId,
      expiresAt: { gt: new Date() },
      ...(excludeToken ? { token: { not: excludeToken } } : {}),
    },
    _sum: { reservedFiles: true, reservedBytes: true },
  });
  if (
    assets.length + (reservations._sum.reservedFiles ?? 0) + 1 > MEDIA_LIMITS.activeFiles ||
    assets.reduce((sum, a) => sum + a.currentFile.sizeBytes, bytes) +
      (reservations._sum.reservedBytes ?? 0) >
      MEDIA_LIMITS.activeBytes
  )
    throw mediaConflict('MEDIA_QUOTA_EXCEEDED');
}

/** Only database work belongs in claim/write/accept. Provider calls run between
 * transactions. Durable token + expiry fence old processes, not an in-memory lock. */
export class StudioExternalWork {
  constructor(readonly repository: StudioRepository) {}

  async run<P, O, T>(
    command: Command,
    context: MediaRequestContext,
    authorize: (context: MediaRequestContext) => Promise<void>,
    prepare: (tx: Transaction, context: MediaRequestContext) => Promise<P>,
    outside: (prepared: P, lease: ExternalLease) => Promise<O>,
    accept: (tx: Transaction, context: MediaRequestContext, output: O, prepared: P) => Promise<T>,
    reservedBytes: number | ((prepared: P) => number) = 0,
  ): Promise<T> {
    if (
      context.transactionScopeId !== undefined ||
      this.repository.boundary.current() !== undefined
    )
      throw new ValidationError();
    requireActiveStudioRequest();
    const action = command.operation.action;
    const { bookingId, intentDigest } = await studioPhase(context, action, 'authorization', () =>
      this.repository.bindCommand(
        command.bookingId,
        context,
        command.idempotencyKey,
        command.payload,
        authorize,
        command.operation,
      ),
    );
    const key = { bookingId_intentDigest: { bookingId, intentDigest } };
    const token = randomUUID();
    const transact = async <R>(
      work: (tx: Transaction, scoped: MediaRequestContext) => Promise<R>,
    ) => {
      const denials: (() => Promise<void>)[] = [];
      try {
        return await this.repository.boundary.run(
          { bookingId, context: contractContext(context) },
          async (scope) => {
            const tx = this.repository.boundary.requireScope(bookingId, scope);
            return work(tx, {
              ...context,
              transactionScopeId: scope.transactionScopeId!,
              deferDeniedAccess: (persist) => {
                denials.push(persist);
              },
            });
          },
        );
      } finally {
        for (const persist of denials) await persist();
      }
    };
    const assertLease = async (tx: Transaction) => {
      const claim = await tx.invitationExternalWork.findUnique({ where: key });
      if (!claim || claim.token !== token || claim.expiresAt.getTime() <= Date.now())
        throw new RequestInProgressError(1);
    };
    const claim = await studioPhase(context, action, 'claim', () =>
      transact(async (tx, scoped) => {
        requireActiveStudioRequest();
        await authorize(scoped);
        const receipt = await tx.invitationStudioReceipt.findUnique({ where: key });
        if (receipt) return { replay: true as const, result: receipt.result as T };
        const active = await tx.invitationExternalWork.findUnique({ where: key });
        if (active && active.expiresAt.getTime() > Date.now()) throw new RequestInProgressError(1);
        const prepared = await prepare(tx, scoped);
        const bytes = typeof reservedBytes === 'function' ? reservedBytes(prepared) : reservedBytes;
        if (bytes) await checkMediaQuota(tx, bookingId, bytes, active?.token);
        await tx.invitationExternalWork.upsert({
          where: key,
          create: {
            bookingId,
            intentDigest,
            token,
            expiresAt: new Date(Date.now() + EXTERNAL_WORK_LEASE_MS),
            reservedFiles: bytes ? 1 : 0,
            reservedBytes: bytes,
          },
          update: {
            token,
            expiresAt: new Date(Date.now() + EXTERNAL_WORK_LEASE_MS),
            reservedFiles: bytes ? 1 : 0,
            reservedBytes: bytes,
          },
        });
        await authorize(scoped);
        requireActiveStudioRequest();
        return { replay: false as const, prepared };
      }),
    );
    if (claim.replay) return claim.result;
    const lease: ExternalLease = {
      token,
      write: (work) =>
        studioPhase(context, action, 'journal', () =>
          transact(async (tx, scoped) => {
            await assertLease(tx);
            return work(tx, scoped);
          }),
        ),
    };
    try {
      requireActiveStudioRequest();
      const output = await outside(claim.prepared, lease);
      requireActiveStudioRequest();
      return await studioPhase(context, action, 'acceptance', () =>
        transact(async (tx, scoped) => {
          await assertLease(tx);
          await authorize(scoped);
          const receipt = await tx.invitationStudioReceipt.findUnique({ where: key });
          if (receipt) return receipt.result as T;
          const result = await accept(tx, scoped, output, claim.prepared);
          // Locks protect revocation, but time-based session expiry still needs a
          // final current-authority check before the acceptance receipt commits.
          await authorize(scoped);
          requireActiveStudioRequest();
          await tx.invitationStudioReceipt.create({
            data: { bookingId, intentDigest, result: asJson(result) },
          });
          await tx.invitationExternalWork.delete({ where: key });
          return result;
        }),
      );
    } finally {
      // A stale process must never delete its successor's ownership or reservation.
      await studioPhase(context, action, 'release', () =>
        this.repository.prisma.invitationExternalWork.deleteMany({
          where: { bookingId, intentDigest, token },
        }),
      ).catch(() => undefined);
    }
  }
}
