import { randomUUID } from 'node:crypto';
import { Prisma, type StaffCheckInRecord } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { conflict, id, parse } from '../../guest-management/domain/guest-policy.js';
import { json } from '../../guest-management/infrastructure/guest.repository.js';
import {
  checkInInput,
  undoInput,
  isWindowOpen,
  pageInput,
  searchInput,
} from '../domain/staff-policy.js';
import type { StaffService } from './staff.service.js';
import { denied } from './staff.service.js';
import type { StaffRequestContext, StaffSeatingGuidance } from './staff.contracts.js';
import { attendance } from './attendance-readers.js';

const missingGuest = () =>
  new AppError({ status: 404, code: 'GUEST_NOT_FOUND', message: 'Guest not found.' });
export const recordDto = (r: StaffCheckInRecord) => ({
  checkInRecordId: r.id,
  bookingId: r.bookingId,
  guestId: r.guestId,
  action: r.action as 'CHECK_IN' | 'UNDO',
  ledgerRevision: r.ledgerRevision,
  originalCheckInRecordId: r.checkInRecordId,
  guestGroupId: r.guestGroupId,
  groupNameSnapshot: r.groupNameSnapshot,
  groupColorSnapshot: r.groupColorSnapshot,
  actorAccountId: r.actorAccountId,
  eventTime: r.eventTime.toISOString(),
  recordedAt: r.recordedAt.toISOString(),
  reason: r.reason,
  overrideReason: r.overrideReason,
});
export class CheckInService {
  private readonly operationsScopes = new WeakSet<ContractContext>();
  constructor(
    readonly staff: StaffService,
    readonly seating?: StaffSeatingGuidance,
  ) {}
  get guests() {
    return this.staff.guests;
  }
  async window(bookingId: string, scope: ContractContext, at: Date = this.guests.guests.now()) {
    const event = await this.staff.events.requireConfirmedEventContext(bookingId);
    const timeline = await this.guests.owners.timeline.resolveApprovedRevision(
      { bookingId, timelineRevisionId: event.effectiveTimelineRevisionId },
      scope,
    );
    return isWindowOpen(at, timeline.eventDate, timeline.shiftStartTime, timeline.shiftEndTime);
  }
  async access(
    bookingId: string,
    context: StaffRequestContext,
    overrideReason?: string,
    write = false,
  ) {
    const actor = await this.guests.identity.resolver.resolve(context.accessToken);
    if (
      actor.accountId !== context.actorId ||
      !actor.roles.some((r) => r === 'MANAGER' || r === 'STAFF')
    )
      throw new NotFoundError();
    const tx = this.staff.repository.boundary.current(bookingId)!;
    const scope = this.staff.repository.boundary.currentContext(bookingId)!;
    await this.staff.events.requireConfirmedEventContext(bookingId);
    if (!actor.roles.includes('MANAGER')) {
      const assignment = await tx.staffAssignment.findUnique({
        where: { bookingId_staffAccountId: { bookingId, staffAccountId: actor.accountId } },
      });
      if (assignment?.status !== 'ACTIVE') throw denied('EVENT_ASSIGNMENT_REQUIRED');
      if (overrideReason !== undefined) throw denied('MANAGER_OVERRIDE_REQUIRED');
    } else if (write && overrideReason === undefined) throw denied('MANAGER_OVERRIDE_REQUIRED');
    const head = await tx.staffConfiguration.findUnique({ where: { bookingId } });
    if (head?.checkInMode !== 'BY_GUEST_NAME') throw denied('CHECK_IN_DISABLED');
    if (
      !(await this.window(bookingId, scope)) &&
      !(actor.roles.includes('MANAGER') && (overrideReason !== undefined || !write))
    )
      throw denied('CHECK_IN_WINDOW_CLOSED');
    this.operationsScopes.add(scope);
    return actor;
  }
  async requireSeatingScopeAccess(bookingId: string, scope: ContractContext) {
    this.staff.repository.boundary.requireScope(bookingId, scope);
    if (!this.operationsScopes.has(scope)) throw new NotFoundError();
    await Promise.resolve();
  }
  requireAssignedOperationsAccess(bookingId: string, context: StaffRequestContext) {
    const scope = this.staff.repository.boundary.currentContext(bookingId);
    if (scope?.actorAccountId === context.actorId && this.operationsScopes.has(scope))
      return Promise.resolve();
    return this.access(bookingId, context).then(() => undefined);
  }
  checkIn(
    bookingValue: string,
    guestValue: string,
    value: unknown,
    key: string,
    context: StaffRequestContext,
  ) {
    const bookingId = parse(id, bookingValue),
      guestId = parse(id, guestValue),
      input = parse(checkInInput, value);
    return this.staff.command(
      bookingId,
      context,
      key,
      `check-in:${guestId}`,
      input,
      async () => {
        await this.access(bookingId, context, input.overrideReason, true);
        const guest = await this.guests.readers
          .requireGuestForOperations(guestId, context)
          .catch((error: unknown) => {
            if (error instanceof NotFoundError || error instanceof ValidationError)
              throw missingGuest();
            throw error;
          });
        if (guest.bookingId !== bookingId) throw missingGuest();
      },
      async (tx, scope) => {
        const head = await this.staff.configuration(tx, bookingId),
          prior = await this.latest(tx, bookingId, guestId);
        if (prior?.action === 'CHECK_IN') throw conflict('GUEST_ALREADY_CHECKED_IN');
        const at = this.guests.guests.now(),
          eventTime = input.eventTime === undefined ? at : new Date(input.eventTime);
        if (
          eventTime > at ||
          (!(await this.window(bookingId, scope, eventTime)) && input.overrideReason === undefined)
        )
          throw new ValidationError();
        const first = await tx.staffCheckInRecord.findFirst({
          where: { bookingId, guestId, action: 'CHECK_IN' },
          orderBy: { ledgerRevision: 'asc' },
        });
        const guest = await this.guests.readers.requireGuestForOperations(guestId, context);
        const groups = await this.guests.readers.listGuestGroups(bookingId),
          group = groups.find((g) => g.guestGroupId === guest.guestGroupId);
        if (!group) throw missingGuest();
        const retainedGroup =
          first ??
          (await tx.staffCheckInRecord.findFirst({
            where: { bookingId, guestGroupId: group.guestGroupId, action: 'CHECK_IN' },
            orderBy: { ledgerRevision: 'asc' },
          }));
        const row = await tx.staffCheckInRecord.create({
          data: {
            id: randomUUID(),
            bookingId,
            guestId,
            action: 'CHECK_IN',
            ledgerRevision: head.ledgerRevision + 1,
            guestGroupId: retainedGroup?.guestGroupId ?? group.guestGroupId,
            groupNameSnapshot: retainedGroup?.groupNameSnapshot ?? group.name,
            groupColorSnapshot: retainedGroup?.groupColorSnapshot ?? group.color,
            actorAccountId: context.actorId,
            requestId: context.requestId,
            eventTime,
            recordedAt: at,
            overrideReason: input.overrideReason ?? null,
          },
        });
        await this.finish(tx, scope, row);
        return recordDto(row);
      },
    );
  }
  latest(tx: Prisma.TransactionClient, bookingId: string, guestId: string) {
    return tx.staffCheckInRecord.findFirst({
      where: { bookingId, guestId },
      orderBy: { ledgerRevision: 'desc' },
    });
  }
  undo(
    bookingValue: string,
    guestValue: string,
    value: unknown,
    key: string,
    context: StaffRequestContext,
  ) {
    const bookingId = parse(id, bookingValue),
      guestId = parse(id, guestValue),
      input = parse(undoInput, value);
    return this.staff.command(
      bookingId,
      context,
      key,
      `undo:${guestId}`,
      input,
      () => this.access(bookingId, context, input.overrideReason, true),
      async (tx, scope) => {
        const actor = await this.guests.identity.resolver.resolve(context.accessToken),
          head = await this.staff.configuration(tx, bookingId),
          latest = await this.latest(tx, bookingId, guestId);
        if (
          latest?.action !== 'CHECK_IN' ||
          latest.id !== input.checkInRecordId ||
          latest.ledgerRevision !== input.expectedLedgerRevision
        )
          throw conflict('CHECK_IN_CORRECTION_CONFLICT');
        if (!actor.roles.includes('MANAGER') && latest.actorAccountId !== actor.accountId)
          throw denied('CHECK_IN_CORRECTION_FORBIDDEN');
        const at = this.guests.guests.now();
        const row = await tx.staffCheckInRecord.create({
          data: {
            bookingId,
            guestId,
            action: 'UNDO',
            ledgerRevision: head.ledgerRevision + 1,
            checkInRecordId: latest.id,
            guestGroupId: latest.guestGroupId,
            groupNameSnapshot: latest.groupNameSnapshot,
            groupColorSnapshot: latest.groupColorSnapshot,
            actorAccountId: context.actorId,
            requestId: context.requestId,
            eventTime: at,
            recordedAt: at,
            reason: input.reason,
            overrideReason: input.overrideReason ?? null,
          },
        });
        await this.finish(tx, scope, row);
        return recordDto(row);
      },
    );
  }
  async finish(tx: Prisma.TransactionClient, scope: ContractContext, row: StaffCheckInRecord) {
    await tx.staffConfiguration.update({
      where: { bookingId: row.bookingId },
      data: { ledgerRevision: row.ledgerRevision },
    });
    const payload = {
      bookingId: row.bookingId,
      guestId: row.guestId,
      checkInRecordId: row.id,
      ledgerRevision: row.ledgerRevision,
      recordedAt: row.recordedAt.toISOString(),
      ...(row.checkInRecordId === null ? {} : { originalCheckInRecordId: row.checkInRecordId }),
    };
    const eventType =
      row.action === 'CHECK_IN'
        ? 'attendance.guest-checked-in'
        : 'attendance.guest-check-in-undone';
    await tx.staffOutbox.create({
      data: { bookingId: row.bookingId, ledgerRevision: row.ledgerRevision, eventType, payload },
    });
    await tx.auditLog.create({
      data: {
        requestId: scope.requestId,
        actorType: 'USER',
        actorId: scope.actorAccountId,
        action: eventType,
        entityType: 'STAFF_CHECK_IN_RECORD',
        entityId: row.id,
        metadata: { bookingId: row.bookingId, ledgerRevision: row.ledgerRevision },
      },
    });
    await this.snapshot(tx, row.bookingId);
  }
  async snapshot(tx: Prisma.TransactionClient, bookingId: string) {
    const head = await tx.staffConfiguration.update({
      where: { bookingId },
      data: { reportSequence: { increment: 1 } },
    });
    await tx.staffAttendanceSnapshot.create({
      data: {
        bookingId,
        sourceSequence: head.reportSequence,
        payload: json(await attendance(tx, bookingId)),
      },
    });
  }
  history(bookingValue: string, guestValue: string, value: unknown, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      guestId = parse(id, guestValue),
      input = parse(pageInput, value);
    return this.staff.run(
      bookingId,
      context,
      () => this.access(bookingId, context),
      async (tx) => {
        const reference = await this.guests.readers
          .getGuestReference(guestId)
          .catch((error: unknown) => {
            if (error instanceof NotFoundError || error instanceof ValidationError)
              throw missingGuest();
            throw error;
          });
        if (reference.bookingId !== bookingId) throw missingGuest();
        const rows = await tx.staffCheckInRecord.findMany({
          where: { bookingId, guestId, ledgerRevision: { gt: input.afterRevision } },
          orderBy: { ledgerRevision: 'asc' },
          take: input.limit + 1,
        });
        return {
          items: rows.slice(0, input.limit).map(recordDto),
          nextAfterRevision:
            rows.length > input.limit ? rows[input.limit - 1]!.ledgerRevision : null,
        };
      },
    );
  }
  search(bookingValue: string, value: unknown, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      input = parse(searchInput, value);
    return this.staff.run(
      bookingId,
      context,
      () => this.access(bookingId, context),
      async (_tx, scope) => {
        const page = await this.guests.readers.search(bookingId, input, context),
          groups = await this.guests.readers.listGuestGroups(bookingId);
        const guidance = this.seating
          ? await this.seating.getGuidance(bookingId, scope)
          : { seatingPlanRevisionId: null, status: 'ABSENT' as const, groups: [] };
        const guestIds =
          page.items.length === 0
            ? Prisma.empty
            : Prisma.join(page.items.map((r) => Prisma.sql`${r.guestId}::uuid`));
        const firstRows =
          page.items.length === 0
            ? []
            : await _tx.$queryRaw<
                StaffCheckInRecord[]
              >`SELECT DISTINCT ON ("guestId") * FROM "StaffCheckInRecord" WHERE "bookingId"=${bookingId}::uuid AND "guestId" IN (${guestIds}) AND action='CHECK_IN' ORDER BY "guestId","ledgerRevision" ASC`;
        const latestRows =
          page.items.length === 0
            ? []
            : await _tx.$queryRaw<
                StaffCheckInRecord[]
              >`SELECT DISTINCT ON ("guestId") * FROM "StaffCheckInRecord" WHERE "bookingId"=${bookingId}::uuid AND "guestId" IN (${guestIds}) ORDER BY "guestId","ledgerRevision" DESC`;
        const items = page.items.map((r) => {
          const group = groups.find((g) => g.guestGroupId === r.guestGroupId)!;
          const first = firstRows.find((row) => row.guestId === r.guestId);
          const latest = latestRows.find((row) => row.guestId === r.guestId);
          return {
            ...r,
            groupName: group.name,
            groupColor: group.color,
            checkedIn: latest?.action === 'CHECK_IN',
            ledgerRevision: latest?.ledgerRevision ?? 0,
            warning:
              first &&
              (first.guestGroupId !== r.guestGroupId ||
                first.groupNameSnapshot !== group.name ||
                first.groupColorSnapshot !== group.color)
                ? ('GUEST_GROUP_CHANGED' as const)
                : null,
            tableLabels:
              guidance.groups.find((g) => g.guestGroupId === r.guestGroupId)?.tableLabels ?? [],
          };
        });
        return {
          ...page,
          items,
          guidanceStatus: guidance.status,
          seatingPlanRevisionId: guidance.seatingPlanRevisionId,
        };
      },
    );
  }
}
