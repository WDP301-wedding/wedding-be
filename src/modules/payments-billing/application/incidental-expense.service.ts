import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import type {
  createBookingBoundaryUnitOfWork,
  BookingBoundaryUnitOfWork,
} from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { BillingOperationsRepository } from './billing-operations.port.js';
import type { ContractContext } from './payments-billing.providers.js';
import type { createEventEndReader } from '../../booking-lifecycle/infrastructure/event-end.reader.js';
import {
  checkedSum,
  commercialConflict,
} from '../../booking-lifecycle/domain/commercial-contract.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  deleteExpenseSchema,
  expenseSnapshotSchema,
  expenseLineSchema,
  calculateExpenseLine,
} from '../domain/final-invoice.js';

type Options = {
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>;
  boundary: BookingBoundaryUnitOfWork;
  operations: BillingOperationsRepository;
  event: (client: PrismaClient) => ReturnType<typeof createEventEndReader>;
};
export const financialContext = (
  actor: AuthenticatedActor,
  requestId: string,
): ContractContext => ({
  actorAccountId: actor.accountId,
  requestId,
  causationId: requestId,
  authority: 'AUTHENTICATED',
});
export async function readExpenseDraft(client: PrismaClient, bookingId: string) {
  const draft = await client.incidentalExpenseDraft.findUnique({ where: { bookingId } });
  const rows = await client.incidentalExpenseLine.findMany({
    where: { bookingId },
    orderBy: { id: 'asc' },
  });
  const invoice = await client.finalInvoiceHead.findUnique({ where: { bookingId } });
  const lines = rows.map((row) =>
    expenseSnapshotSchema.parse({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      unitPriceVnd: row.unitPriceVnd.toNumber(),
      totalVnd: row.totalVnd.toNumber(),
      note: row.note,
    }),
  );
  return {
    bookingId,
    revision: draft?.revision ?? 0,
    finalized: invoice?.currentRevisionId != null,
    lines,
    totalVnd: checkedSum(lines.map((l) => l.totalVnd)),
  };
}
export function createIncidentalExpenseService(options: Options) {
  async function mutate(
    bookingId: string,
    expectedRevision: number,
    actor: AuthenticatedActor,
    requestId: string,
    action: string,
    operation: (
      client: PrismaClient,
    ) => Promise<{ lineId: string; before: unknown; after: unknown }>,
  ) {
    return options.boundary.run(
      { bookingId, context: financialContext(actor, requestId) },
      (scoped) =>
        options.scope.withClient(bookingId, scoped, async (client) => {
          await options.operations.requireManager(bookingId, scoped);
          await options.event(client).requireEnded(bookingId);
          const current = await readExpenseDraft(client, bookingId);
          if (current.finalized) throw commercialConflict('INVOICE_FINALIZED');
          if (current.revision !== expectedRevision)
            throw commercialConflict('EXPENSE_REVISION_STALE');
          await client.incidentalExpenseDraft.upsert({
            where: { bookingId },
            create: { bookingId },
            update: {},
          });
          const change = await operation(client);
          const result = await readExpenseDraft(client, bookingId);
          const evidence = JSON.parse(
            JSON.stringify({
              bookingId,
              revision: result.revision,
              before: change.before,
              after: change.after,
            }),
          ) as Prisma.InputJsonObject;
          await client.auditLog.create({
            data: {
              requestId,
              actorType: 'USER',
              actorId: actor.accountId,
              action: 'billing.incidental-' + action,
              entityType: 'incidental-expense',
              entityId: change.lineId,
              metadata: evidence,
            },
          });
          return result;
        }),
    );
  }
  async function requireLine(client: PrismaClient, bookingId: string, lineId: string) {
    const line = await client.incidentalExpenseLine.findFirst({ where: { id: lineId, bookingId } });
    if (!line) throw new NotFoundError();
    return line;
  }
  return Object.freeze({
    async authorize(
      bookingId: string,
      actor: AuthenticatedActor,
      requestId: string,
      managerOnly = false,
    ) {
      const context = financialContext(actor, requestId);
      await options.boundary.run({ bookingId, context }, async (scoped) => {
        if (managerOnly) await options.operations.requireManager(bookingId, scoped);
        else await options.operations.requireReadAccess(bookingId, scoped);
      });
    },
    async read(bookingId: string, actor: AuthenticatedActor, requestId: string) {
      return options.boundary.run(
        { bookingId, context: financialContext(actor, requestId) },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            await options.operations.requireReadAccess(bookingId, scoped);
            return readExpenseDraft(client, bookingId);
          }),
      );
    },
    async create(
      bookingId: string,
      raw: z.infer<typeof createExpenseSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const { expectedRevision, ...input } = createExpenseSchema.parse(raw);
      return mutate(bookingId, expectedRevision, actor, requestId, 'created', async (client) => {
        const data = { id: randomUUID(), bookingId, ...calculateExpenseLine(input) };
        await client.incidentalExpenseLine.create({ data });
        return { lineId: data.id, before: null, after: data };
      });
    },
    async update(
      bookingId: string,
      lineId: string,
      raw: z.infer<typeof updateExpenseSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const { expectedRevision, ...patch } = updateExpenseSchema.parse(raw);
      return mutate(bookingId, expectedRevision, actor, requestId, 'updated', async (client) => {
        const before = await requireLine(client, bookingId, lineId);
        const input = expenseLineSchema.parse({
          name: before.name,
          quantity: before.quantity,
          unit: before.unit,
          unitPriceVnd: before.unitPriceVnd.toNumber(),
          note: before.note,
          ...patch,
        });
        const after = calculateExpenseLine(input);
        await client.incidentalExpenseLine.update({ where: { id: lineId }, data: after });
        return { lineId, before, after };
      });
    },
    async remove(
      bookingId: string,
      lineId: string,
      raw: z.infer<typeof deleteExpenseSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const { expectedRevision } = deleteExpenseSchema.parse(raw);
      return mutate(bookingId, expectedRevision, actor, requestId, 'removed', async (client) => {
        const before = await requireLine(client, bookingId, lineId);
        await client.incidentalExpenseLine.delete({ where: { id: lineId } });
        return { lineId, before, after: null };
      });
    },
  });
}
