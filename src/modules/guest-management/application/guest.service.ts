import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  Guest,
  GuestGroup,
  GuestWorkspace,
} from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { type GuestRepository, json } from '../infrastructure/guest.repository.js';
import type { GuestOwnerPorts, GuestRequestContext } from './guest.contracts.js';
import {
  conflict,
  defaultGroups,
  digest,
  groupWriteSchema,
  groupPatchSchema,
  guestWriteSchema,
  guestPatchSchema,
  id,
  importCommitSchema,
  importPreviewSchema,
  importRowsSchema,
  normalizeGroupName,
  parse,
  planWriteSchema,
} from '../domain/guest-policy.js';

export const groupDto = (row: GuestGroup) => ({
  guestGroupId: row.id,
  bookingId: row.bookingId,
  name: row.name,
  color: row.color,
  status: row.status as 'ACTIVE' | 'ARCHIVED',
  revision: row.revision,
});
export const guestDto = (row: Guest) => ({
  guestId: row.id,
  bookingId: row.bookingId,
  guestGroupId: row.guestGroupId,
  name: row.name,
  phone: row.phone,
  operationalNote: row.operationalNote,
  status: row.status as 'ACTIVE' | 'ARCHIVED',
  revision: row.revision,
});

export class GuestService {
  constructor(
    readonly repository: GuestRepository,
    readonly resolver: AuthenticatedActorResolver,
    readonly owners: GuestOwnerPorts,
    readonly now: () => Date = () => new Date(),
  ) {}
  async authorize(bookingId: string, context: GuestRequestContext) {
    const actor = await this.resolver.resolve(context.accessToken);
    if (
      actor.accountId !== context.actorId ||
      !actor.roles.some((r) => r === 'MANAGER' || r === 'COUPLE')
    )
      throw new NotFoundError();
    if (!actor.roles.includes('MANAGER'))
      await this.owners.booking.requireBookingAccess({
        bookingId,
        accountId: actor.accountId,
        minimum: 'FULL',
      });
    await this.owners.booking.requireConfirmedEventContext(bookingId);
  }
  read<T>(
    bookingValue: string,
    context: GuestRequestContext,
    work: (
      tx: Prisma.TransactionClient,
      scope: ContractContext,
      workspace: GuestWorkspace,
    ) => Promise<T>,
  ) {
    const bookingId = parse(id, bookingValue);
    return this.repository.run(
      bookingId,
      context,
      () => this.authorize(bookingId, context),
      async (tx, scope) => work(tx, scope, await this.initialize(tx, bookingId, scope)),
    );
  }
  command<T>(
    bookingValue: string,
    context: GuestRequestContext,
    key: string,
    action: string,
    input: unknown,
    work: (
      tx: Prisma.TransactionClient,
      scope: ContractContext,
      workspace: GuestWorkspace,
    ) => Promise<T>,
  ) {
    const bookingId = parse(id, bookingValue);
    return this.repository.command(
      bookingId,
      context,
      key,
      action,
      input,
      () => this.authorize(bookingId, context),
      async (tx, scope) => work(tx, scope, await this.initialize(tx, bookingId, scope)),
    );
  }
  private async initialize(
    tx: Prisma.TransactionClient,
    bookingId: string,
    scope: ContractContext,
  ) {
    const existing = await tx.guestWorkspace.findUnique({ where: { bookingId } });
    if (existing !== null) return existing;
    const source = await this.owners.planning.getSource(bookingId, scope);
    const planRevisionId = source.sourceGuestPlanRevisionId ?? randomUUID();
    await tx.guestPlanRevision.create({
      data: {
        id: planRevisionId,
        bookingId,
        revision: 1,
        sourceSequence: source.sourceSequence,
        planningHeadcount: source.planningHeadcount,
        sourceBookingRevision: source.bookingRevision,
        actorAccountId: scope.actorAccountId!,
      },
    });
    const workspace = await tx.guestWorkspace.create({
      data: {
        bookingId,
        planRevisionId,
        planSequence: source.sourceSequence,
        initializedBookingRevision: source.bookingRevision,
      },
    });
    for (const group of defaultGroups) {
      const row = await tx.guestGroup.create({
        data: {
          id: randomUUID(),
          bookingId,
          ...group,
          normalizedName: normalizeGroupName(group.name),
        },
      });
      await this.repository.history(
        tx,
        scope,
        bookingId,
        'GROUP',
        row.id,
        row.revision,
        groupDto(row),
      );
    }
    await this.report(tx, bookingId);
    return workspace;
  }
  groups(bookingId: string, context: GuestRequestContext) {
    return this.read(bookingId, context, async (tx) =>
      (await tx.guestGroup.findMany({ where: { bookingId }, orderBy: { id: 'asc' } })).map(
        groupDto,
      ),
    );
  }
  createGroup(bookingId: string, value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(groupWriteSchema, value);
    return this.command(bookingId, context, key, 'group.create', input, async (tx, scope) => {
      await this.uniqueGroup(tx, bookingId, input.name);
      if ((await tx.guestGroup.count({ where: { bookingId, status: 'ACTIVE' } })) >= 100)
        throw conflict('GUEST_GROUP_QUOTA_EXCEEDED');
      const row = await tx.guestGroup.create({
        data: {
          id: randomUUID(),
          bookingId,
          ...input,
          normalizedName: normalizeGroupName(input.name),
        },
      });
      await this.repository.history(
        tx,
        scope,
        bookingId,
        'GROUP',
        row.id,
        row.revision,
        groupDto(row),
      );
      await this.changed(tx, bookingId);
      return groupDto(row);
    });
  }
  updateGroup(
    bookingId: string,
    groupValue: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
  ) {
    const groupId = parse(id, groupValue),
      input = parse(groupPatchSchema, value);
    return this.command(
      bookingId,
      context,
      key,
      `group.update:${groupId}`,
      input,
      async (tx, scope) => {
        const row = await tx.guestGroup.findFirst({ where: { id: groupId, bookingId } });
        if (row === null) throw new NotFoundError();
        if (row.revision !== input.expectedRevision) throw conflict('GUEST_GROUP_REVISION_STALE');
        if (input.name !== undefined) await this.uniqueGroup(tx, bookingId, input.name, groupId);
        if (
          row.status === 'ARCHIVED' &&
          input.status === 'ACTIVE' &&
          (await tx.guestGroup.count({ where: { bookingId, status: 'ACTIVE' } })) >= 100
        )
          throw conflict('GUEST_GROUP_QUOTA_EXCEEDED');
        if (
          input.status === 'ARCHIVED' &&
          (await tx.guest.count({ where: { bookingId, guestGroupId: groupId, status: 'ACTIVE' } }))
        )
          throw conflict('GUEST_GROUP_IN_USE');
        const result = await tx.guestGroup.update({
          where: { id: groupId },
          data: {
            name: input.name ?? row.name,
            color: input.color ?? row.color,
            status: input.status ?? row.status,
            normalizedName: normalizeGroupName(input.name ?? row.name),
            revision: input.expectedRevision + 1,
          },
        });
        await this.repository.history(
          tx,
          scope,
          bookingId,
          'GROUP',
          groupId,
          result.revision,
          groupDto(result),
        );
        await this.changed(tx, bookingId);
        return groupDto(result);
      },
    );
  }
  private async uniqueGroup(
    tx: Prisma.TransactionClient,
    bookingId: string,
    name: string,
    except?: string,
  ) {
    const row = await tx.guestGroup.findUnique({
      where: { bookingId_normalizedName: { bookingId, normalizedName: normalizeGroupName(name) } },
    });
    if (row !== null && row.id !== except) throw conflict('GUEST_GROUP_NAME_CONFLICT');
  }
  private async activeGroup(tx: Prisma.TransactionClient, bookingId: string, guestGroupId: string) {
    if (
      (await tx.guestGroup.findFirst({
        where: { id: guestGroupId, bookingId, status: 'ACTIVE' },
      })) === null
    )
      throw new NotFoundError();
  }
  private async quota(tx: Prisma.TransactionClient, bookingId: string, delta: number) {
    if ((await tx.guest.count({ where: { bookingId, status: 'ACTIVE' } })) + delta > 10000)
      throw conflict('GUEST_LIST_QUOTA_EXCEEDED');
  }
  createGuest(bookingId: string, value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(guestWriteSchema, value);
    return this.command(bookingId, context, key, 'guest.create', input, async (tx, scope) => {
      await this.activeGroup(tx, bookingId, input.guestGroupId);
      await this.quota(tx, bookingId, 1);
      const row = await tx.guest.create({
        data: {
          id: randomUUID(),
          bookingId,
          ...input,
          phone: input.phone ?? null,
          operationalNote: input.operationalNote ?? null,
          normalizedName: normalizeGroupName(input.name),
        },
      });
      await this.repository.history(
        tx,
        scope,
        bookingId,
        'GUEST',
        row.id,
        row.revision,
        guestDto(row),
      );
      await this.changed(tx, bookingId);
      return guestDto(row);
    });
  }
  updateGuest(
    bookingId: string,
    guestValue: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
  ) {
    const guestId = parse(id, guestValue),
      input = parse(guestPatchSchema, value);
    return this.command(
      bookingId,
      context,
      key,
      `guest.update:${guestId}`,
      input,
      async (tx, scope) => {
        const row = await this.requireGuest(tx, bookingId, guestId);
        if (row.revision !== input.expectedRevision) throw conflict('GUEST_REVISION_STALE');
        if ((input.status ?? row.status) === 'ACTIVE')
          await this.activeGroup(tx, bookingId, input.guestGroupId ?? row.guestGroupId);
        if (input.status === 'ACTIVE' && row.status === 'ARCHIVED')
          await this.quota(tx, bookingId, 1);
        const result = await tx.guest.update({
          where: { id: guestId },
          data: {
            name: input.name ?? row.name,
            guestGroupId: input.guestGroupId ?? row.guestGroupId,
            phone: input.phone === undefined ? row.phone : input.phone,
            operationalNote:
              input.operationalNote === undefined ? row.operationalNote : input.operationalNote,
            status: input.status ?? row.status,
            normalizedName: normalizeGroupName(input.name ?? row.name),
            revision: input.expectedRevision + 1,
          },
        });
        if (input.status === 'ARCHIVED')
          await tx.guestInvitationCredential.updateMany({
            where: { guestId, revokedAt: null },
            data: { revokedAt: this.now() },
          });
        await this.repository.history(
          tx,
          scope,
          bookingId,
          'GUEST',
          guestId,
          result.revision,
          guestDto(result),
        );
        await this.changed(tx, bookingId);
        return guestDto(result);
      },
    );
  }
  async requireGuest(tx: Prisma.TransactionClient, bookingId: string, guestId: string) {
    const row = await tx.guest.findFirst({ where: { id: guestId, bookingId } });
    if (row === null)
      throw new AppError({
        status: 404,
        code: 'GUEST_NOT_FOUND',
        message: 'The Guest is unavailable.',
      });
    return row;
  }
  plan(bookingId: string, context: GuestRequestContext) {
    return this.read(bookingId, context, (tx, _scope, workspace) => this.planDto(tx, workspace));
  }
  async planDto(tx: Prisma.TransactionClient, workspace: GuestWorkspace) {
    const row = await tx.guestPlanRevision.findUniqueOrThrow({
      where: { id: workspace.planRevisionId },
    });
    return {
      bookingId: workspace.bookingId,
      sourceGuestPlanRevisionId: row.id,
      sourceSequence: row.sourceSequence,
      planningHeadcount: row.planningHeadcount,
      revision: row.revision,
    };
  }
  updatePlan(bookingId: string, value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(planWriteSchema, value);
    return this.command(
      bookingId,
      context,
      key,
      'plan.update',
      input,
      async (tx, scope, workspace) => {
        if (workspace.planRevision !== input.expectedRevision)
          throw conflict('GUEST_PLAN_REVISION_STALE');
        const current = await this.planDto(tx, workspace);
        const source = await this.owners.planning.getSource(bookingId, scope);
        if (
          source.planningHeadcount !== current.planningHeadcount ||
          source.sourceSequence !== current.sourceSequence ||
          (workspace.planSequence > 0 &&
            source.sourceGuestPlanRevisionId !== current.sourceGuestPlanRevisionId)
        )
          throw conflict('HEADCOUNT_SOURCE_CONFLICT');
        if (input.planningHeadcount === current.planningHeadcount) return current;
        const event = await this.owners.booking.requireConfirmedEventContext(bookingId);
        await this.owners.capacity.requireCapacity(event.hallId, input.planningHeadcount, scope);
        const row = await tx.guestPlanRevision.create({
          data: {
            id: randomUUID(),
            bookingId,
            revision: workspace.planRevision + 1,
            sourceSequence: workspace.planSequence + 1,
            planningHeadcount: input.planningHeadcount,
            sourceBookingRevision: source.bookingRevision,
            actorAccountId: context.actorId,
          },
        });
        const result = await this.owners.planning.synchronize(
          {
            bookingId,
            sourceGuestPlanRevisionId: row.id,
            sourceSequence: row.sourceSequence,
            expectedAttendees: row.planningHeadcount,
          },
          scope,
        );
        if (result.outcome !== 'APPLIED') throw conflict('HEADCOUNT_SOURCE_CONFLICT');
        const updated = await tx.guestWorkspace.update({
          where: { bookingId },
          data: {
            planRevisionId: row.id,
            planRevision: row.revision,
            planSequence: row.sourceSequence,
          },
        });
        await this.repository.audit(
          tx,
          scope,
          bookingId,
          'guest.plan-changed',
          row.id,
          row.revision,
        );
        await this.changed(tx, bookingId);
        await tx.guestOutbox.create({
          data: {
            eventId: randomUUID(),
            bookingId,
            eventType: 'guest.plan-changed',
            sourceSequence: row.sourceSequence,
            payload: {
              bookingId,
              planRevisionId: row.id,
              planRevision: row.revision,
              sourceSequence: row.sourceSequence,
            },
          },
        });
        return this.planDto(tx, updated);
      },
    );
  }
  preview(bookingId: string, value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(importPreviewSchema, value);
    return this.command(
      bookingId,
      context,
      key,
      'import.preview',
      input,
      async (tx, _scope, workspace) => {
        let createdCount = 0,
          updatedCount = 0,
          unchangedCount = 0;
        for (const row of input.rows) {
          await this.activeGroup(tx, bookingId, row.guestGroupId);
          const prior = await tx.guest.findUnique({
            where: { bookingId_externalRowKey: { bookingId, externalRowKey: row.externalRowKey } },
          });
          if (prior === null) createdCount++;
          else if (sameImport(prior, row)) unchangedCount++;
          else {
            if (!input.allowUpdates || prior.status === 'ARCHIVED')
              throw conflict('GUEST_IMPORT_ROW_CONFLICT');
            updatedCount++;
          }
        }
        await this.quota(tx, bookingId, createdCount);
        const expiresAt = new Date(this.now().getTime() + 30 * 60000);
        const previewId = randomUUID();
        const hash = digest({
          bookingId,
          actorId: context.actorId,
          listSequence: workspace.listSequence,
          ...input,
        });
        await tx.guestImportPreview.create({
          data: {
            id: previewId,
            bookingId,
            actorAccountId: context.actorId,
            listSequence: workspace.listSequence,
            digest: hash,
            rows: json(input.rows),
            allowUpdates: input.allowUpdates,
            createdCount,
            updatedCount,
            unchangedCount,
            expiresAt,
          },
        });
        return {
          previewId,
          digest: hash,
          listSequence: workspace.listSequence,
          createdCount,
          updatedCount,
          unchangedCount,
          expiresAt: expiresAt.toISOString(),
        };
      },
    );
  }
  import(bookingId: string, value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(importCommitSchema, value);
    return this.command(
      bookingId,
      context,
      key,
      'import.commit',
      input,
      async (tx, scope, workspace) => {
        const preview = await tx.guestImportPreview.findFirst({
          where: { id: input.previewId, bookingId, actorAccountId: context.actorId },
        });
        if (preview === null) throw new NotFoundError();
        if (
          preview.digest !== input.digest ||
          preview.listSequence !== workspace.listSequence ||
          preview.expiresAt <= this.now()
        )
          throw conflict('GUEST_IMPORT_PREVIEW_STALE');
        const rows = parse(importRowsSchema, preview.rows);
        await this.quota(tx, bookingId, preview.createdCount);
        for (const row of rows) {
          await this.activeGroup(tx, bookingId, row.guestGroupId);
          const prior = await tx.guest.findUnique({
            where: { bookingId_externalRowKey: { bookingId, externalRowKey: row.externalRowKey } },
          });
          if (prior !== null && sameImport(prior, row)) continue;
          if (prior !== null && (!preview.allowUpdates || prior.status === 'ARCHIVED'))
            throw conflict('GUEST_IMPORT_ROW_CONFLICT');
          const data = {
            ...row,
            phone: row.phone ?? null,
            operationalNote: row.operationalNote ?? null,
            normalizedName: normalizeGroupName(row.name),
          };
          const result =
            prior === null
              ? await tx.guest.create({ data: { id: randomUUID(), bookingId, ...data } })
              : await tx.guest.update({
                  where: { id: prior.id },
                  data: { ...data, revision: { increment: 1 } },
                });
          await this.repository.history(
            tx,
            scope,
            bookingId,
            'GUEST',
            result.id,
            result.revision,
            guestDto(result),
          );
        }
        if (preview.createdCount + preview.updatedCount > 0) await this.changed(tx, bookingId);
        return {
          createdCount: preview.createdCount,
          updatedCount: preview.updatedCount,
          unchangedCount: preview.unchangedCount,
        };
      },
    );
  }
  private async changed(tx: Prisma.TransactionClient, bookingId: string) {
    await tx.guestWorkspace.update({
      where: { bookingId },
      data: { listSequence: { increment: 1 } },
    });
    await this.report(tx, bookingId);
  }
  private async report(tx: Prisma.TransactionClient, bookingId: string) {
    const workspace = await tx.guestWorkspace.findUniqueOrThrow({ where: { bookingId } });
    const groups = await tx.guestGroup.findMany({ where: { bookingId }, orderBy: { id: 'asc' } });
    const membership = await tx.guest.groupBy({
      by: ['guestGroupId'],
      where: { bookingId, status: 'ACTIVE' },
      _count: { id: true },
    });
    const plan = await this.planDto(tx, workspace);
    const payload = {
      bookingId,
      planningHeadcount: plan.planningHeadcount,
      sourceGuestPlanRevisionId: plan.sourceGuestPlanRevisionId,
      planSourceSequence: plan.sourceSequence,
      listedGuestCount: membership.reduce((total, g) => total + g._count.id, 0),
      groups: groups.map((g) => ({
        ...groupDto(g),
        listedGuestCount: membership.find((m) => m.guestGroupId === g.id)?._count.id ?? 0,
      })),
    };
    await tx.guestOutbox.create({
      data: {
        eventId: randomUUID(),
        bookingId,
        eventType: 'guest.workspace-changed',
        sourceSequence: workspace.listSequence,
        payload: json(payload),
      },
    });
  }
}
function sameImport(
  prior: Guest,
  row: {
    name: string;
    guestGroupId: string;
    phone?: string | null | undefined;
    operationalNote?: string | null | undefined;
  },
) {
  return (
    prior.status === 'ACTIVE' &&
    prior.name === row.name &&
    prior.guestGroupId === row.guestGroupId &&
    prior.phone === (row.phone ?? null) &&
    prior.operationalNote === (row.operationalNote ?? null)
  );
}
