import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  PrismaBookingBoundary,
  ContractContext,
} from '../../../core/database/booking-boundary.js';
import { IdempotencyKeyReusedError } from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import { digest, id, parse } from '../domain/guest-policy.js';
import type { GuestRequestContext } from '../application/guest.contracts.js';

export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export class GuestRepository {
  constructor(
    readonly prisma: PrismaClient,
    readonly boundary: PrismaBookingBoundary,
  ) {}
  async run<T>(
    bookingValue: string,
    context: GuestRequestContext,
    authorize: () => Promise<void>,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
    mode: 'READ' | 'WRITE' = 'WRITE',
  ) {
    const bookingId = parse(id, bookingValue);
    return this.boundary[mode === 'READ' ? 'runRead' : 'run'](
      {
        bookingId,
        context: {
          requestId: context.requestId,
          causationId: context.requestId,
          actorAccountId: context.actorId,
          authority: 'AUTHENTICATED',
        },
      },
      async (scope) => {
        await authorize();
        return work(this.boundary.requireScope(bookingId, scope), scope);
      },
    );
  }
  command<T>(
    bookingId: string,
    context: GuestRequestContext,
    keyValue: string,
    action: string,
    payload: unknown,
    authorize: () => Promise<void>,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
  ) {
    const key = parse(idempotencyKeySchema, keyValue);
    const intentDigest = digest({ actorId: context.actorId, action, key });
    const commandDigest = digest({ actorId: context.actorId, action, payload });
    return this.run(bookingId, context, authorize, async (tx, scope) => {
      const prior = await tx.guestCommand.findUnique({
        where: { bookingId_intentDigest: { bookingId, intentDigest } },
      });
      if (prior !== null) {
        if (prior.commandDigest !== commandDigest) throw new IdempotencyKeyReusedError();
        return prior.result as T;
      }
      const result = await work(tx, scope);
      await tx.guestCommand.create({
        data: { bookingId, intentDigest, commandDigest, result: json(result) },
      });
      return result;
    });
  }
  async history(
    tx: Prisma.TransactionClient,
    scope: ContractContext,
    bookingId: string,
    entityType: 'GROUP' | 'GUEST',
    entityId: string,
    revision: number,
    snapshot: unknown,
  ) {
    await tx.guestHistory.create({
      data: {
        id: randomUUID(),
        bookingId,
        entityType,
        entityId,
        revision,
        snapshot: json(snapshot),
      },
    });
    await this.audit(
      tx,
      scope,
      bookingId,
      `guest.${entityType.toLowerCase()}-changed`,
      entityId,
      revision,
    );
  }
  async audit(
    tx: Prisma.TransactionClient,
    scope: ContractContext,
    bookingId: string,
    action: string,
    entityId: string,
    revision: number,
  ) {
    await tx.auditLog.create({
      data: {
        requestId: scope.requestId,
        actorType: 'USER',
        actorId: scope.actorAccountId,
        action,
        entityType: 'GUEST_WORKSPACE',
        entityId,
        metadata: { bookingId, revision },
      },
    });
  }
}
