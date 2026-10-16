import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, SeatingPlan, SeatingPlanRevision } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { IdempotencyKeyReusedError, NotFoundError } from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import type {
  LayoutService,
  LayoutVersionSnapshot,
} from '../../venue-catalog/application/layout.service.js';
import type { VenueSelectionEligibilityReader } from '../../venue-catalog/application/selection-eligibility.reader.js';
import type { PrintableSeatingContentRegistry } from '../../invitation-studio/application/studio.contracts.js';
import { seatingRenderSchema, digest } from '../../invitation-studio/domain/studio-policy.js';
import type {
  SeatingRequestContext,
  SeatingStaffAccess,
  SeatingGuidanceReader,
  SeatingPlanReader,
} from './seating.contracts.js';
import {
  capacityProblem,
  conflict,
  confirmationInput,
  exceptionInput,
  id,
  labelSnapshot,
  parse,
  remapLabels,
  revisionInput,
  selectInput,
} from '../domain/seating-policy.js';

const exceptionSchema = z.strictObject({
  approvalId: id,
  approvedBookingRevision: z.int().positive(),
  approvedHeadcount: z.int().positive(),
  actorAccountId: id,
  reason: z.string().min(10).max(500),
  approvedAt: z.iso.datetime(),
});
export const snapshotSchema = z.strictObject({
  layoutName: z.string(),
  minGuests: z.int().positive(),
  maxGuests: z.int().positive(),
  totalSeatCapacity: z.int().positive(),
  labels: z.array(labelSnapshot).max(500),
  renderSnapshot: seatingRenderSchema,
  droppedTableIds: z.array(id),
  managerException: exceptionSchema.nullable(),
});
export const planViewSchema = snapshotSchema.extend({
  seatingPlanId: id,
  bookingId: id,
  revisionId: id,
  revisionNumber: z.int().positive(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'REQUIRES_REVIEW']),
  layoutTemplateVersionId: id,
  expectedAttendees: z.int().nonnegative(),
  bookingRevision: z.int().positive(),
  currentPlanningHeadcount: z.int().nonnegative(),
  currentBookingRevision: z.int().positive(),
  warnings: z.array(z.string()),
  snapshotDigest: z.string().length(64),
});
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type Snapshot = z.infer<typeof snapshotSchema>;
export class SeatingService implements SeatingGuidanceReader, SeatingPlanReader {
  constructor(
    readonly guest: ReturnType<typeof createGuestServices>,
    readonly layouts: Pick<LayoutService, 'resolveVersion' | 'listCurrentVersionsForHall'>,
    readonly venue: VenueSelectionEligibilityReader,
    readonly registry: PrintableSeatingContentRegistry,
    readonly now: () => Date = () => new Date(),
    readonly staff?: SeatingStaffAccess,
  ) {}
  private get boundary() {
    return this.guest.boundary;
  }
  private get prisma() {
    return this.guest.repository.prisma;
  }
  private async authorize(bookingId: string, context: SeatingRequestContext) {
    await this.guest.guests.authorize(bookingId, context);
  }
  private run<T>(
    bookingValue: string,
    context: SeatingRequestContext,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
    mode: 'READ' | 'WRITE' = 'WRITE',
  ) {
    const bookingId = parse(id, bookingValue);
    return this.guest.repository.run(
      bookingId,
      context,
      () => this.authorize(bookingId, context),
      work,
      mode,
    );
  }
  private command<T>(
    bookingId: string,
    context: SeatingRequestContext,
    keyValue: string,
    action: string,
    input: unknown,
    work: (tx: Prisma.TransactionClient, scope: ContractContext) => Promise<T>,
  ) {
    const key = parse(idempotencyKeySchema, keyValue),
      intentDigest = digest({ action, key, actorId: context.actorId }),
      commandDigest = digest(input);
    return this.run(bookingId, context, async (tx, scope) => {
      const previous = await tx.seatingCommand.findUnique({
        where: { bookingId_intentDigest: { bookingId, intentDigest } },
      });
      if (previous !== null) {
        if (previous.commandDigest !== commandDigest) throw new IdempotencyKeyReusedError();
        return previous.result as T;
      }
      const result = await work(tx, scope);
      await tx.seatingCommand.create({
        data: { bookingId, intentDigest, commandDigest, result: json(result) },
      });
      return result;
    });
  }
  private async current(tx: Prisma.TransactionClient, bookingId: string, planId?: string) {
    const head = await tx.seatingPlan.findUnique({ where: { bookingId } });
    if (head === null || (planId !== undefined && head.id !== planId)) throw new NotFoundError();
    const row = await tx.seatingPlanRevision.findUniqueOrThrow({ where: { id: head.revisionId } });
    return { head, row, snapshot: parse(snapshotSchema, row.snapshot) };
  }
  private view(
    row: SeatingPlanRevision,
    planning?: { planningHeadcount: number; bookingRevision: number },
  ) {
    return parse(planViewSchema, {
      ...parse(snapshotSchema, row.snapshot),
      seatingPlanId: row.planId,
      bookingId: row.bookingId,
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      status: row.status,
      layoutTemplateVersionId: row.layoutTemplateVersionId,
      expectedAttendees: row.planningHeadcount,
      bookingRevision: row.bookingRevision,
      currentPlanningHeadcount: planning?.planningHeadcount ?? row.planningHeadcount,
      currentBookingRevision: planning?.bookingRevision ?? row.bookingRevision,
      warnings: row.status === 'REQUIRES_REVIEW' ? ['SEATING_REQUIRES_REVIEW'] : [],
      snapshotDigest: row.snapshotDigest,
    });
  }
  private async facts(bookingId: string, layoutId: string, scope: ContractContext) {
    const event = await this.guest.owners.booking.requireConfirmedEventContext(bookingId);
    const planning = await this.guest.owners.planning.getSource(bookingId, scope);
    const eligibility = await this.venue.getLayoutEligibility(layoutId, scope);
    if (eligibility.hallId !== event.hallId) throw new NotFoundError();
    const layout = await this.layouts.resolveVersion(layoutId);
    return { planning, eligibility, layout };
  }
  private async snapshot(
    layout: LayoutVersionSnapshot,
    bookingId: string,
    labels: readonly { layoutTableId: string; guestGroupId: string }[],
    droppedTableIds: string[] = [],
  ): Promise<Snapshot> {
    if (new Set(labels.map((v) => v.layoutTableId)).size !== labels.length)
      throw conflict('TABLE_NOT_IN_LAYOUT');
    const groups = await this.guest.readers.listGuestGroups(bookingId);
    const resolved = labels.map((l) => {
      if (!layout.tables.some((t) => t.tableId === l.layoutTableId))
        throw conflict('TABLE_NOT_IN_LAYOUT');
      const group = groups.find((g) => g.guestGroupId === l.guestGroupId && g.status === 'ACTIVE');
      if (group === undefined) throw conflict('GUEST_GROUP_UNAVAILABLE');
      return { ...l, groupName: group.name, colorSnapshot: group.color };
    });
    return parse(snapshotSchema, {
      layoutName: layout.name,
      minGuests: layout.minGuests,
      maxGuests: layout.maxGuests,
      totalSeatCapacity: layout.totalSeatCapacity,
      labels: resolved,
      droppedTableIds,
      managerException: null,
      renderSnapshot: layout.tables.map((t) => {
        const label = resolved.find((l) => l.layoutTableId === t.tableId);
        return {
          layoutTableId: t.tableId,
          tableLabel: t.label,
          shape: t.shape,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          rotationDegrees: t.rotationDegrees,
          guestGroupId: label?.guestGroupId ?? null,
          guestGroupName: label?.groupName ?? null,
          color: label?.colorSnapshot ?? null,
        };
      }),
    });
  }
  private async save(
    tx: Prisma.TransactionClient,
    scope: ContractContext,
    bookingId: string,
    head: SeatingPlan | null,
    status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW',
    layoutId: string,
    planning: { bookingRevision: number; planningHeadcount: number },
    snapshot: Snapshot,
  ) {
    const row = await tx.seatingPlanRevision.create({
      data: {
        id: randomUUID(),
        bookingId,
        planId: head?.id ?? randomUUID(),
        revisionNumber: (head?.revisionNumber ?? 0) + 1,
        predecessorRevisionId: head?.revisionId ?? null,
        status,
        layoutTemplateVersionId: layoutId,
        bookingRevision: planning.bookingRevision,
        planningHeadcount: planning.planningHeadcount,
        snapshot: json(snapshot),
        snapshotDigest: digest(snapshot),
        createdByAccountId: scope.actorAccountId,
        createdAt: this.now(),
      },
    });
    const data = {
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      observedBookingRevision: Math.max(
        head?.observedBookingRevision ?? 0,
        planning.bookingRevision,
      ),
    };
    await tx.seatingPlan.upsert({
      where: { bookingId },
      create: { bookingId, id: row.planId, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        requestId: scope.requestId,
        actorType: scope.authority === 'SYSTEM' ? 'SYSTEM' : 'USER',
        actorId: scope.actorAccountId,
        action: `seating.${status.toLowerCase()}`,
        entityType: 'SEATING_PLAN',
        entityId: row.planId,
        metadata: { revisionId: row.id, revision: row.revisionNumber, bookingId },
      },
    });
    if (status !== 'DRAFT')
      await tx.seatingOutbox.create({
        data: {
          id: randomUUID(),
          bookingId,
          revisionId: row.id,
          revisionNumber: row.revisionNumber,
          eventType:
            status === 'CONFIRMED' ? 'seating.plan-confirmed' : 'seating.plan-requires-review',
          payload: json({
            version: 1,
            bookingId,
            revisionId: row.id,
            revisionNumber: row.revisionNumber,
            bookingRevision: planning.bookingRevision,
            planningHeadcount: planning.planningHeadcount,
          }),
        },
      });
    return this.view(row);
  }
  private bookingRevision(expected: number, actual: number) {
    if (expected !== actual) throw conflict('SEATING_REVISION_STALE');
  }
  private async invalidateRegistry(
    row: SeatingPlanRevision,
    scope: ContractContext,
    reasonCode:
      | 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE'
      | 'LAYOUT_RETIRED'
      | 'SEATING_PLAN_REPLACED'
      | 'PLANNING_HEADCOUNT_CHANGED',
  ) {
    await this.registry.markRequiresReview(
      {
        bookingId: row.bookingId,
        seatingPlanRevisionId: row.id,
        seatingPlanRevisionNumber: row.revisionNumber,
        reasonCode,
      },
      scope,
    );
  }
  options(bookingId: string, context: SeatingRequestContext) {
    return this.run(
      bookingId,
      context,
      async (_tx, scope) => {
        const event = await this.guest.owners.booking.requireConfirmedEventContext(bookingId),
          planning = await this.guest.owners.planning.getSource(bookingId, scope);
        const layouts = await this.layouts.listCurrentVersionsForHall(event.hallId);
        const batch = this.venue.getLayoutEligibilities
          ? new Map(
              (
                await this.venue.getLayoutEligibilities(
                  layouts.map((layout) => layout.id),
                  scope,
                )
              ).map((facts) => [facts.layoutTemplateVersionId, facts]),
            )
          : undefined;
        const items = [];
        for (const layout of layouts) {
          const eligibility =
            batch?.get(layout.id) ?? (await this.venue.getLayoutEligibility(layout.id, scope));
          if (
            !eligibility.currentForNewSelection ||
            !eligibility.templateActive ||
            !eligibility.hallActive
          )
            continue;
          const warning = capacityProblem(planning.planningHeadcount, {
            ...layout,
            ...eligibility,
          });
          items.push({
            layoutTemplateVersionId: layout.id,
            name: layout.name,
            minGuests: layout.minGuests,
            maxGuests: layout.maxGuests,
            totalSeatCapacity: layout.totalSeatCapacity,
            compatible: warning === null,
            warning,
          });
        }
        items.sort(
          (a, b) =>
            Number(b.compatible) - Number(a.compatible) ||
            a.totalSeatCapacity - b.totalSeatCapacity ||
            a.layoutTemplateVersionId.localeCompare(b.layoutTemplateVersionId),
        );
        return {
          planningHeadcount: planning.planningHeadcount,
          bookingRevision: planning.bookingRevision,
          items,
        };
      },
      'READ',
    );
  }
  select(bookingId: string, value: unknown, key: string, context: SeatingRequestContext) {
    const input = parse(selectInput, value);
    return this.command(bookingId, context, key, 'select', input, async (tx, scope) => {
      const { planning, eligibility, layout } = await this.facts(
        bookingId,
        input.layoutTemplateVersionId,
        scope,
      );
      this.bookingRevision(input.expectedBookingRevision, planning.bookingRevision);
      if (
        !eligibility.hallActive ||
        !eligibility.templateActive ||
        !eligibility.currentForNewSelection
      )
        throw conflict('LAYOUT_RETIRED');
      if (await tx.seatingPlan.findUnique({ where: { bookingId } }))
        throw conflict('SEATING_PLAN_EXISTS');
      return this.save(
        tx,
        scope,
        bookingId,
        null,
        'DRAFT',
        layout.id,
        planning,
        await this.snapshot(layout, bookingId, []),
      );
    });
  }
  revise(
    bookingId: string,
    planValue: string,
    value: unknown,
    key: string,
    context: SeatingRequestContext,
  ) {
    const planId = parse(id, planValue),
      input = parse(revisionInput, value);
    return this.command(
      bookingId,
      context,
      key,
      'revise',
      { planId, ...input },
      async (tx, scope) => {
        const { head, row, snapshot } = await this.current(tx, bookingId, planId);
        this.bookingRevision(input.expectedRevision, row.revisionNumber);
        const { planning, eligibility, layout } = await this.facts(
          bookingId,
          input.layoutTemplateVersionId ?? row.layoutTemplateVersionId,
          scope,
        );
        if (
          input.layoutTemplateVersionId !== undefined &&
          (!eligibility.hallActive ||
            !eligibility.templateActive ||
            !eligibility.currentForNewSelection)
        )
          throw conflict('LAYOUT_RETIRED');
        const remapped = remapLabels(
          snapshot.labels,
          layout.tables.map((t) => t.tableId),
          input.remap ?? [],
        );
        const next = await this.snapshot(
          layout,
          bookingId,
          input.labels ?? remapped.labels,
          remapped.droppedTableIds,
        );
        // New drafts disable the previous eligibility; already captured files remain history.
        await this.invalidateRegistry(row, scope, 'SEATING_PLAN_REPLACED');
        return this.save(tx, scope, bookingId, head, 'DRAFT', layout.id, planning, next);
      },
    );
  }
  confirm(
    bookingId: string,
    planValue: string,
    value: unknown,
    key: string,
    context: SeatingRequestContext,
    exception = false,
  ) {
    const planId = parse(id, planValue),
      input = parse(exception ? exceptionInput : confirmationInput, value);
    return this.command(
      bookingId,
      context,
      key,
      exception ? 'exception' : 'confirm',
      { planId, ...input },
      async (tx, scope) => {
        if (exception) {
          const actor = await this.guest.identity.resolver.resolve(context.accessToken);
          if (!actor.roles.includes('MANAGER')) throw new NotFoundError();
        }
        const { head, row, snapshot } = await this.current(tx, bookingId, planId);
        this.bookingRevision(input.expectedRevision, row.revisionNumber);
        const { planning, eligibility, layout } = await this.facts(
          bookingId,
          row.layoutTemplateVersionId,
          scope,
        );
        this.bookingRevision(input.expectedBookingRevision, planning.bookingRevision);
        if (!eligibility.hallActive || !eligibility.templateActive)
          throw conflict('LAYOUT_RETIRED');
        const problem = capacityProblem(
          planning.planningHeadcount,
          { ...layout, ...eligibility },
          exception,
        );
        if (problem !== null) throw conflict(problem);
        const next = await this.snapshot(layout, bookingId, snapshot.labels);
        if (exception)
          next.managerException = {
            approvalId: randomUUID(),
            approvedBookingRevision: planning.bookingRevision,
            approvedHeadcount: planning.planningHeadcount,
            actorAccountId: context.actorId,
            reason: parse(exceptionInput, value).reason,
            approvedAt: this.now().toISOString(),
          };
        const result = await this.save(
          tx,
          scope,
          bookingId,
          head,
          'CONFIRMED',
          layout.id,
          planning,
          next,
        );
        const e = next.managerException;
        await this.registry.registerConfirmed(
          {
            bookingId,
            seatingPlanRevisionId: result.revisionId,
            seatingPlanRevisionNumber: result.revisionNumber,
            layoutTemplateVersionId: layout.id,
            contentDigest: digest(next.renderSnapshot),
            renderSnapshot: next.renderSnapshot,
            validityProof: {
              bookingRevision: planning.bookingRevision,
              expectedAttendees: planning.planningHeadcount,
              minGuests: layout.minGuests,
              maxGuests: layout.maxGuests,
              totalSeatCapacity: eligibility.totalSeatCapacity,
              managerException:
                e === null
                  ? null
                  : {
                      approvalId: e.approvalId,
                      approvedBookingRevision: e.approvedBookingRevision,
                      approvedHeadcount: e.approvedHeadcount,
                    },
            },
          },
          scope,
        );
        return result;
      },
    );
  }
  private async revalidate(
    tx: Prisma.TransactionClient,
    scope: ContractContext,
    bookingId: string,
    eventRevision?: number,
    readOnly = false,
  ) {
    const { head, row, snapshot } = await this.current(tx, bookingId);
    if (eventRevision !== undefined && eventRevision <= head.observedBookingRevision)
      return this.view(row);
    const { planning, eligibility, layout } = await this.facts(
      bookingId,
      row.layoutTemplateVersionId,
      scope,
    );
    if (eventRevision !== undefined && eventRevision > planning.bookingRevision)
      throw conflict('SEATING_REVISION_STALE');
    const retired = !eligibility.hallActive || !eligibility.templateActive;
    const headcountChanged = row.planningHeadcount !== planning.planningHeadcount;
    const e = snapshot.managerException;
    const invalidException =
      e !== null &&
      (e.approvedBookingRevision !== planning.bookingRevision ||
        e.approvedHeadcount !== planning.planningHeadcount);
    const problem = capacityProblem(
      planning.planningHeadcount,
      { ...layout, ...eligibility },
      e !== null && !invalidException,
    );
    if (
      row.status === 'CONFIRMED' &&
      (retired || headcountChanged || invalidException || problem !== null)
    ) {
      if (readOnly) return { ...this.view(row, planning), status: 'REQUIRES_REVIEW' as const };
      this.boundary.requireWriteScope(bookingId, scope);
      await this.invalidateRegistry(
        row,
        scope,
        retired
          ? 'LAYOUT_RETIRED'
          : headcountChanged
            ? 'PLANNING_HEADCOUNT_CHANGED'
            : 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE',
      );
      return this.save(
        tx,
        scope,
        bookingId,
        head,
        'REQUIRES_REVIEW',
        layout.id,
        planning,
        snapshot,
      );
    }
    if (!readOnly && planning.bookingRevision > head.observedBookingRevision) {
      this.boundary.requireWriteScope(bookingId, scope);
      await tx.seatingPlan.update({
        where: { bookingId },
        data: { observedBookingRevision: planning.bookingRevision },
      });
    }
    return this.view(row, planning);
  }
  read(bookingId: string, planValue: string, context: SeatingRequestContext) {
    const planId = parse(id, planValue);
    return this.run(
      bookingId,
      context,
      async (tx, scope) => {
        await this.current(tx, bookingId, planId);
        return this.readView(tx, scope, bookingId);
      },
      'READ',
    );
  }
  readCurrent(bookingId: string, context: SeatingRequestContext) {
    return this.run(
      bookingId,
      context,
      async (tx, scope) => {
        const head = await tx.seatingPlan.findUnique({ where: { bookingId } });
        if (head === null) return null;
        return this.readView(tx, scope, bookingId);
      },
      'READ',
    );
  }
  private async readView(tx: Prisma.TransactionClient, scope: ContractContext, bookingId: string) {
    return this.revalidate(tx, scope, bookingId);
  }
  async bookingForPlan(planValue: string, context: SeatingRequestContext) {
    const actor = await this.guest.identity.resolver.resolve(context.accessToken);
    if (actor.accountId !== context.actorId || !actor.roles.includes('MANAGER'))
      throw new NotFoundError();
    const head = await this.prisma.seatingPlan.findUnique({ where: { id: parse(id, planValue) } });
    if (head === null) throw new NotFoundError();
    return head.bookingId;
  }
  async reconcile(bookingValue: string, eventRevision?: number) {
    const bookingId = parse(id, bookingValue);
    if (eventRevision !== undefined) parse(z.int().positive(), eventRevision);
    return this.boundary.runSystemInvalidation(
      {
        bookingId,
        purpose: 'SEATING_REGISTRY_INVALIDATION',
        context: {
          authority: 'SYSTEM',
          actorAccountId: null,
          requestId: randomUUID(),
          causationId: randomUUID(),
        },
      },
      async (scope) => {
        const tx = this.boundary.requireScope(bookingId, scope);
        if ((await tx.seatingPlan.findUnique({ where: { bookingId } })) === null) return null;
        return this.revalidate(tx, scope, bookingId, eventRevision);
      },
    );
  }
  async reconcilePage(afterBookingId?: string, limit = 100) {
    parse(z.int().min(1).max(100), limit);
    const rows = await this.prisma.seatingPlan.findMany({
      where: afterBookingId === undefined ? {} : { bookingId: { gt: parse(id, afterBookingId) } },
      orderBy: { bookingId: 'asc' },
      take: limit,
    });
    const failures: string[] = [];
    for (const row of rows) {
      try {
        await this.reconcile(row.bookingId);
      } catch {
        failures.push(row.bookingId);
      }
    }
    return { nextBookingId: rows.length === limit ? rows.at(-1)!.bookingId : null, failures };
  }
  async getGuidance(bookingId: string, context: ContractContext) {
    const tx = this.boundary.requireScope(bookingId, context);
    if (this.staff === undefined) throw new NotFoundError();
    await this.staff.requireAssignedOperationsAccess(bookingId, context);
    const head = await tx.seatingPlan.findUnique({ where: { bookingId } });
    if (head === null)
      return { seatingPlanRevisionId: null, status: 'ABSENT' as const, groups: [] };
    const current = await this.revalidate(tx, context, bookingId, undefined, true);
    const groups = new Map<
      string,
      { guestGroupId: string; groupName: string; color: string; tableLabels: string[] }
    >();
    for (const label of current.labels) {
      const group = groups.get(label.guestGroupId) ?? {
        guestGroupId: label.guestGroupId,
        groupName: label.groupName,
        color: label.colorSnapshot,
        tableLabels: [],
      };
      group.tableLabels.push(
        current.renderSnapshot.find((t) => t.layoutTableId === label.layoutTableId)!.tableLabel,
      );
      groups.set(label.guestGroupId, group);
    }
    return {
      seatingPlanRevisionId: current.revisionId,
      status: current.status,
      groups: [...groups.values()],
    };
  }
  async requireCurrentPlan(bookingId: string) {
    const value = await this.reconcile(bookingId);
    if (value === null) throw new NotFoundError();
    return value;
  }
  async resolveRevision(revisionValue: string) {
    const row = await this.prisma.seatingPlanRevision.findUnique({
      where: { id: parse(id, revisionValue) },
    });
    if (row === null) throw new NotFoundError();
    return this.view(row);
  }
}
