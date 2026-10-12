import type {
  Prisma,
  StaffConfiguration,
  StaffAssignment,
} from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import {
  AppError,
  NotFoundError,
  IdempotencyKeyReusedError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import type { BookingMediaPrerequisiteReader } from '../../booking-lifecycle/application/booking-readers.js';
import { digest, id, parse, conflict } from '../../guest-management/domain/guest-policy.js';
import { json } from '../../guest-management/infrastructure/guest.repository.js';
import { configurationInput, assignmentInput, revokeInput } from '../domain/staff-policy.js';
import type { StaffRequestContext } from './staff.contracts.js';

export const configurationDto = (r: StaffConfiguration) => ({
  bookingId: r.bookingId,
  checkInMode: r.checkInMode as 'NONE' | 'BY_GUEST_NAME',
  revision: r.revision,
  locked: r.ledgerRevision > 0,
});
export const assignmentDto = (r: StaffAssignment) => ({
  assignmentId: r.id,
  bookingId: r.bookingId,
  staffAccountId: r.staffAccountId,
  status: r.status as 'ACTIVE' | 'REVOKED',
  revision: r.revision,
});
export const denied = (code: string) => new AppError({ status: 403, code, message: code });

export class StaffService {
  onConfigurationChanged?: (tx: Prisma.TransactionClient, bookingId: string) => Promise<void>;
  constructor(
    readonly guests: ReturnType<typeof createGuestServices>,
    readonly events: BookingMediaPrerequisiteReader,
  ) {}
  get repository() {
    return this.guests.repository;
  }
  async manager(context: StaffRequestContext) {
    const actor = await this.guests.identity.resolver.resolve(context.accessToken);
    if (actor.accountId !== context.actorId || !actor.roles.includes('MANAGER'))
      throw new NotFoundError();
    return actor;
  }
  async ownerAccess(bookingId: string, context: StaffRequestContext) {
    const actor = await this.guests.identity.resolver.resolve(context.accessToken);
    if (
      actor.accountId !== context.actorId ||
      !actor.roles.some((r) => r === 'MANAGER' || r === 'COUPLE')
    )
      throw new NotFoundError();
    if (!actor.roles.includes('MANAGER'))
      await this.events.requireBookingAccess({
        bookingId,
        accountId: actor.accountId,
        minimum: 'FULL',
      });
    await this.events.requireConfirmedEventContext(bookingId);
  }
  run<T>(
    bookingId: string,
    context: StaffRequestContext,
    authorize: () => Promise<unknown>,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
  ) {
    return this.repository.run(
      bookingId,
      context,
      async () => {
        await authorize();
      },
      work,
    );
  }
  command<T>(
    bookingId: string,
    context: StaffRequestContext,
    keyValue: string,
    action: string,
    payload: unknown,
    authorize: () => Promise<unknown>,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
  ) {
    const key = parse(idempotencyKeySchema, keyValue),
      intentDigest = digest({ actorId: context.actorId, action, key }),
      commandDigest = digest({ action, payload });
    return this.run(bookingId, context, authorize, async (tx, scope) => {
      const prior = await tx.staffCommand.findUnique({
        where: { bookingId_intentDigest: { bookingId, intentDigest } },
      });
      if (prior !== null) {
        if (prior.commandDigest !== commandDigest) throw new IdempotencyKeyReusedError();
        return prior.result as T;
      }
      const result = await work(tx, scope);
      await tx.staffCommand.create({
        data: { bookingId, intentDigest, commandDigest, result: json(result) },
      });
      return result;
    });
  }
  async configuration(tx: Prisma.TransactionClient, bookingId: string) {
    const existing = await tx.staffConfiguration.findUnique({ where: { bookingId } });
    if (existing) return existing;
    const created = await tx.staffConfiguration.create({ data: { bookingId } });
    const scope = this.repository.boundary.currentContext(bookingId)!;
    await this.history(
      tx,
      scope,
      bookingId,
      bookingId,
      'CONFIGURATION',
      1,
      configurationDto(created),
    );
    await this.onConfigurationChanged?.(tx, bookingId);
    return created;
  }
  async history(
    tx: Prisma.TransactionClient,
    scope: ContractContext,
    bookingId: string,
    entityId: string,
    entityType: string,
    revision: number,
    snapshot: unknown,
  ) {
    await tx.staffHistory.create({
      data: {
        bookingId,
        entityId,
        entityType,
        revision,
        snapshot: json(snapshot),
        actorAccountId: scope.actorAccountId!,
        requestId: scope.requestId,
      },
    });
    await tx.auditLog.create({
      data: {
        requestId: scope.requestId,
        actorType: 'USER',
        actorId: scope.actorAccountId,
        action: `staff.${entityType.toLowerCase()}-changed`,
        entityType: 'STAFF_OPERATIONS',
        entityId,
        metadata: { bookingId, revision },
      },
    });
  }
  settings(bookingValue: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue);
    return this.run(
      bookingId,
      context,
      () => this.ownerAccess(bookingId, context),
      async (tx) => configurationDto(await this.configuration(tx, bookingId)),
    );
  }
  configure(bookingValue: string, value: unknown, key: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      input = parse(configurationInput, value);
    return this.command(
      bookingId,
      context,
      key,
      'configure',
      input,
      () => this.guests.guests.authorize(bookingId, context),
      async (tx, scope) => {
        const head = await this.configuration(tx, bookingId);
        if (head.revision !== input.expectedRevision)
          throw conflict('CHECK_IN_CONFIGURATION_STALE');
        if (input.checkInMode !== head.checkInMode && head.ledgerRevision > 0)
          throw conflict('CHECK_IN_MODE_LOCKED');
        if (
          input.checkInMode === 'BY_GUEST_NAME' &&
          head.checkInMode !== input.checkInMode &&
          !(await this.guests.readers.getActiveGuestCount(bookingId))
        )
          throw conflict('NAMED_GUEST_LIST_REQUIRED');
        const changed = await tx.staffConfiguration.update({
          where: { bookingId },
          data: { checkInMode: input.checkInMode, revision: { increment: 1 } },
        });
        const result = configurationDto(changed);
        await this.history(
          tx,
          scope,
          bookingId,
          bookingId,
          'CONFIGURATION',
          changed.revision,
          result,
        );
        await this.onConfigurationChanged?.(tx, bookingId);
        return result;
      },
    );
  }
  assignments(bookingValue: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue);
    return this.run(
      bookingId,
      context,
      async () => {
        await this.manager(context);
        await this.guests.owners.booking.requireConfirmedEventContext(bookingId);
      },
      async (tx) =>
        (
          await tx.staffAssignment.findMany({
            where: { bookingId },
            orderBy: { id: 'asc' },
            take: 100,
          })
        ).map(assignmentDto),
    );
  }
  assign(bookingValue: string, value: unknown, key: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      input = parse(assignmentInput, value);
    return this.command(
      bookingId,
      context,
      key,
      'assign',
      input,
      async () => {
        await this.manager(context);
        await this.guests.owners.booking.requireConfirmedEventContext(bookingId);
      },
      async (tx, scope) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${input.staffAccountId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "AccountRole" WHERE "accountId"=${input.staffAccountId}::uuid ORDER BY id FOR SHARE`;
        const account = await tx.account.findUnique({
          where: { id: input.staffAccountId },
          include: { roles: true },
        });
        if (account?.status !== 'ACTIVE' || !account.roles.some((r) => r.role === 'STAFF'))
          throw new NotFoundError();
        const where = {
          bookingId_staffAccountId: { bookingId, staffAccountId: input.staffAccountId },
        };
        const prior = await tx.staffAssignment.findUnique({ where });
        if ((prior?.revision ?? 0) !== input.expectedRevision)
          throw conflict('STAFF_ASSIGNMENT_STALE');
        if (prior === null && (await tx.staffAssignment.count({ where: { bookingId } })) >= 100)
          throw conflict('STAFF_ASSIGNMENT_QUOTA_EXCEEDED');
        const row = await tx.staffAssignment.upsert({
          where,
          create: { bookingId, staffAccountId: input.staffAccountId },
          update: { status: 'ACTIVE', revision: { increment: 1 } },
        });
        const result = assignmentDto(row);
        await this.history(tx, scope, bookingId, row.id, 'ASSIGNMENT', row.revision, result);
        return result;
      },
    );
  }
  revoke(
    bookingValue: string,
    assignmentValue: string,
    value: unknown,
    key: string,
    context: StaffRequestContext,
  ) {
    const bookingId = parse(id, bookingValue),
      assignmentId = parse(id, assignmentValue),
      input = parse(revokeInput, value);
    return this.command(
      bookingId,
      context,
      key,
      `revoke:${assignmentId}`,
      input,
      () => this.manager(context),
      async (tx, scope) => {
        const row = await tx.staffAssignment.findFirst({ where: { id: assignmentId, bookingId } });
        if (!row) throw new NotFoundError();
        if (row.revision !== input.expectedRevision) throw conflict('STAFF_ASSIGNMENT_STALE');
        const result = assignmentDto(
          await tx.staffAssignment.update({
            where: { id: row.id },
            data: { status: 'REVOKED', revision: { increment: 1 } },
          }),
        );
        await this.history(tx, scope, bookingId, row.id, 'ASSIGNMENT', result.revision, {
          ...result,
          reason: input.reason,
        });
        return result;
      },
    );
  }
}
