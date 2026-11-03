import { checkInWindow, isWindowOpen } from '../domain/staff-policy.js';
import { Prisma, type StaffWorkItem } from '../../../generated/prisma/client.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import { conflict, id, parse } from '../../guest-management/domain/guest-policy.js';
import { attendance } from './attendance-readers.js';
import { configurationDto, denied } from './staff.service.js';
import type { StaffService } from './staff.service.js';
import type { CheckInService } from './check-in.service.js';
import type { StaffRequestContext, StaffSeatingGuidance } from './staff.contracts.js';
import {
  eventListQuery,
  eventListSchema,
  workspaceSchema,
  workCreateInput,
  workUpdateInput,
  workPageQuery,
  workItemSchema,
  workHistoryQuery,
} from '../domain/workspace-policy.js';
const dto = (row: StaffWorkItem) =>
  workItemSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
export class OperationsWorkspaceService {
  constructor(
    readonly staff: StaffService,
    readonly journal: CheckInService,
    readonly seating?: StaffSeatingGuidance,
  ) {}
  async list(value: unknown, context: StaffRequestContext) {
    const query = parse(eventListQuery, value);
    const actor = await this.staff.guests.identity.resolver.resolve(context.accessToken);
    if (
      actor.accountId !== context.actorId ||
      !actor.roles.some((r) => r === 'STAFF' || r === 'MANAGER')
    )
      throw new NotFoundError();
    const manager = actor.roles.includes('MANAGER');
    const rows = await this.staff.repository.prisma.$queryRaw<
      {
        bookingId: string;
        bookingCode: string;
        alias: string | null;
        eventDate: string;
        hallName: string;
        shiftCode: 'LUNCH' | 'DINNER';
        phase: 'CONFIRMED' | 'COMPLETED';
      }[]
    >(Prisma.sql`SELECT b.id AS "bookingId", b."bookingCode", b.alias, to_char(b."eventDate",'YYYY-MM-DD') AS "eventDate", p."hallName", b."shiftCode", b.phase
      FROM "Booking" b JOIN "BookingProposalSnapshot" p ON p."bookingId"=b.id
      WHERE b.phase::text=${query.phase} AND EXISTS (SELECT 1 FROM "BookingDepositSettlement" d WHERE d."bookingId"=b.id AND d."promotionStatus"='SUCCEEDED')
      AND (${manager} OR EXISTS (SELECT 1 FROM "StaffAssignment" a WHERE a."bookingId"=b.id AND a."staffAccountId"=${actor.accountId}::uuid AND a.status='ACTIVE'))
      AND (${query.afterId ?? null}::uuid IS NULL OR b.id > ${query.afterId ?? null}::uuid)
      AND (position(lower(${query.q}) in lower(b."bookingCode"))>0 OR position(lower(${query.q}) in lower(coalesce(b.alias,'')))>0)
      ORDER BY b.id ASC LIMIT ${query.limit + 1}`);
    return eventListSchema.parse({
      items: rows.slice(0, query.limit),
      nextAfterId: rows.length > query.limit ? rows[query.limit - 1]!.bookingId : null,
    });
  }
  read(bookingValue: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue);
    return this.staff.run(
      bookingId,
      context,
      () => this.journal.assignedAccess(bookingId, context),
      async (tx, scope) => {
        const event = await this.staff.events.requireConfirmedEventContext(bookingId);
        const timeline = await this.staff.guests.owners.timeline.resolveApprovedRevision(
          { bookingId, timelineRevisionId: event.effectiveTimelineRevisionId },
          scope,
        );
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { bookingCode: true, alias: true },
        });
        const head = await tx.staffConfiguration.findUnique({ where: { bookingId } });
        const settings = head
          ? configurationDto(head)
          : { bookingId, checkInMode: 'NONE' as const, revision: 1, locked: false };
        const assignments = await tx.staffAssignment.findMany({
          where: { bookingId, status: 'ACTIVE' },
          take: 100,
          orderBy: { id: 'asc' },
          select: { staffAccountId: true },
        });
        const members = await tx.account.findMany({
          where: {
            id: { in: assignments.map((a) => a.staffAccountId) },
            status: 'ACTIVE',
            roles: { some: { role: 'STAFF' } },
          },
          select: { id: true, displayName: true, displayEmail: true },
        });
        const actor = await this.staff.guests.identity.resolver.resolve(context.accessToken);
        return workspaceSchema.parse({
          bookingId,
          ...booking,
          settings,
          attendance: await attendance(tx, bookingId),
          listedGuestCount: await this.staff.guests.readers.getActiveGuestCount(bookingId),
          planningHeadcount: event.planningHeadcount,
          windowOpen: isWindowOpen(
            this.staff.guests.guests.now(),
            timeline.eventDate,
            timeline.shiftStartTime,
            timeline.shiftEndTime,
          ),
          windowOpensAt: checkInWindow(
            timeline.eventDate,
            timeline.shiftStartTime,
            timeline.shiftEndTime,
          ).opensAt,
          windowClosesAt: checkInWindow(
            timeline.eventDate,
            timeline.shiftStartTime,
            timeline.shiftEndTime,
          ).closesAt,
          isManager: actor.roles.includes('MANAGER'),
          timeline,
          seating: (await this.seating?.getOperationalPlan?.(bookingId, scope)) ?? {
            status: 'ABSENT',
            renderSnapshot: [],
          },
          members: members.map((a) => ({
            accountId: a.id,
            label: a.displayName ?? a.displayEmail,
          })),
        });
      },
      'READ',
    );
  }
  page(bookingValue: string, value: unknown, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      query = parse(workPageQuery, value);
    return this.staff.run(
      bookingId,
      context,
      () => this.journal.assignedAccess(bookingId, context),
      async (tx) => {
        if (
          query.afterId &&
          !(await tx.staffWorkItem.findFirst({
            where: { bookingId, id: query.afterId, ...(query.kind ? { kind: query.kind } : {}) },
            select: { id: true },
          }))
        )
          throw new ValidationError();
        const rows = await tx.staffWorkItem.findMany({
          where: { bookingId, ...(query.kind ? { kind: query.kind } : {}) },
          ...(query.afterId ? { cursor: { id: query.afterId }, skip: 1 } : {}),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
        });
        return {
          items: rows.slice(0, query.limit).map(dto),
          nextAfterId: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
        };
      },
      'READ',
    );
  }
  async requireAssignee(tx: Prisma.TransactionClient, bookingId: string, accountId: string | null) {
    if (!accountId) return;
    const assigned = await tx.staffAssignment.findUnique({
      where: { bookingId_staffAccountId: { bookingId, staffAccountId: accountId } },
    });
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { status: true, roles: true },
    });
    if (
      assigned?.status !== 'ACTIVE' ||
      account?.status !== 'ACTIVE' ||
      !account.roles.some((r) => r.role === 'STAFF')
    )
      throw denied('EVENT_ASSIGNMENT_REQUIRED');
  }
  create(bookingValue: string, value: unknown, key: string, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      input = parse(workCreateInput, value);
    if (input.kind === 'HANDOVER' && input.assignedAccountId === context.actorId)
      throw denied('STAFF_HANDOVER_ACK_REQUIRED');
    return this.staff.command(
      bookingId,
      context,
      key,
      'work:create',
      input,
      async () => {
        const actor = await this.journal.assignedAccess(bookingId, context);
        if (input.kind === 'TASK' && !actor.roles.includes('MANAGER'))
          throw denied('STAFF_WORK_ACTION_FORBIDDEN');
        if (
          input.kind === 'INCIDENT' &&
          input.assignedAccountId !== null &&
          !actor.roles.includes('MANAGER')
        )
          throw denied('STAFF_WORK_ACTION_FORBIDDEN');
      },
      async (tx, scope) => {
        await this.requireAssignee(tx, bookingId, input.assignedAccountId);
        const row = await tx.staffWorkItem.create({
          data: { bookingId, ...input, createdByAccountId: context.actorId },
        });
        const result = dto(row);
        await this.staff.history(tx, scope, bookingId, row.id, 'WORK_ITEM', row.revision, {
          ...result,
          note: 'CREATED',
        });
        return result;
      },
    );
  }
  update(
    bookingValue: string,
    itemValue: string,
    value: unknown,
    key: string,
    context: StaffRequestContext,
  ) {
    const bookingId = parse(id, bookingValue),
      itemId = parse(id, itemValue),
      input = parse(workUpdateInput, value);
    return this.staff.command(
      bookingId,
      context,
      key,
      `work:update:${itemId}`,
      input,
      () => this.journal.assignedAccess(bookingId, context),
      async (tx, scope) => {
        const row = await tx.staffWorkItem.findFirst({ where: { bookingId, id: itemId } });
        if (!row) throw new NotFoundError();
        if (row.revision !== input.expectedRevision) throw conflict('STAFF_WORK_REVISION_STALE');
        const actor = await this.staff.guests.identity.resolver.resolve(context.accessToken);
        const manager = actor.roles.includes('MANAGER');
        if (
          !manager &&
          (row.kind === 'INCIDENT' ||
            row.assignedAccountId !== context.actorId ||
            input.assignedAccountId !== undefined ||
            row.status === 'DONE')
        )
          throw denied('STAFF_WORK_ACTION_FORBIDDEN');
        if (
          row.kind === 'HANDOVER' &&
          (input.status !== 'DONE' || row.createdByAccountId === context.actorId)
        )
          throw denied('STAFF_HANDOVER_ACK_REQUIRED');
        await this.requireAssignee(tx, bookingId, input.assignedAccountId ?? null);
        const updated = await tx.staffWorkItem.update({
          where: { id: itemId },
          data: {
            status: input.status,
            ...(input.assignedAccountId !== undefined
              ? { assignedAccountId: input.assignedAccountId }
              : {}),
            revision: { increment: 1 },
          },
        });
        const result = dto(updated);
        await this.staff.history(tx, scope, bookingId, itemId, 'WORK_ITEM', updated.revision, {
          ...result,
          note: input.note,
        });
        return result;
      },
    );
  }
  history(bookingValue: string, itemValue: string, value: unknown, context: StaffRequestContext) {
    const bookingId = parse(id, bookingValue),
      itemId = parse(id, itemValue),
      query = parse(workHistoryQuery, value);
    return this.staff.run(
      bookingId,
      context,
      () => this.journal.assignedAccess(bookingId, context),
      async (tx) => {
        if (
          !(await tx.staffWorkItem.findFirst({
            where: { bookingId, id: itemId },
            select: { id: true },
          }))
        )
          throw new NotFoundError();
        const rows = await tx.staffHistory.findMany({
          where: {
            bookingId,
            entityId: itemId,
            entityType: 'WORK_ITEM',
            revision: { gt: query.afterRevision },
          },
          orderBy: { revision: 'asc' },
          take: 26,
        });
        return {
          items: rows.slice(0, 25).map((r) => ({
            revision: r.revision,
            actorAccountId: r.actorAccountId,
            createdAt: r.createdAt.toISOString(),
            snapshot: r.snapshot,
          })),
          nextAfterRevision: rows.length > 25 ? rows[24]!.revision : null,
        };
      },
      'READ',
    );
  }
}
