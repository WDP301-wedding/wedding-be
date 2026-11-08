import type { IncidentalExpenseReview, PrismaClient } from '../../../generated/prisma/client.js';
import { createHash } from 'node:crypto';
import type { ExpenseLineInput } from '../domain/final-invoice.js';
import { expenseReviewViewSchema, calculateExpenseLine } from '../domain/final-invoice.js';
import { incidentalPricingSchema } from '../../venue-catalog/domain/incidental-offering.js';
import { commercialConflict } from '../../booking-lifecycle/domain/commercial-contract.js';

export function expenseReviewView(row: IncidentalExpenseReview) {
  if (expenseReviewDigest(row.document) !== row.documentDigest)
    throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
  return expenseReviewViewSchema.parse({
    id: row.id,
    revisionNumber: row.revisionNumber,
    draftRevision: row.draftRevision,
    type: row.type,
    state: row.state,
    document: row.document,
    documentDigest: row.documentDigest,
    managerAccountId: row.managerAccountId,
    managerApprovedAt: row.managerApprovedAt.toISOString(),
    coupleAccountId: row.coupleAccountId,
    coupleApprovedAt: row.coupleApprovedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt.toISOString(),
  });
}
export function expenseReviewDigest(document: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(expenseReviewViewSchema.shape.document.parse(document)))
    .digest('hex');
}
export async function resolveExpenseLine(
  client: PrismaClient,
  bookingId: string,
  input: ExpenseLineInput,
) {
  const booking = await client.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { incidentalPolicyVersion: true, incidentalPricing: true },
  });
  if (booking.incidentalPolicyVersion === null) {
    const { name, quantity, unit, unitPriceVnd, note } = input;
    return calculateExpenseLine({
      name,
      quantity,
      unit,
      unitPriceVnd,
      ...(note === undefined ? {} : { note }),
    });
  }
  const pricing = incidentalPricingSchema.parse(booking.incidentalPricing);
  if (input.sourceType === 'CATALOG' && input.offeringId) {
    const price = pricing.find((p) => p.offeringId === input.offeringId);
    if (!price) throw commercialConflict('INCIDENTAL_OFFERING_NOT_AGREED');
    return calculateExpenseLine({
      name: price.name,
      unit: price.unit,
      unitPriceVnd: price.unitPriceVnd,
      quantity: input.quantity,
      note: input.note ?? null,
      sourceType: 'CATALOG',
      offeringId: price.offeringId,
      offeringRevision: price.revision,
    });
  }
  if (
    input.sourceType !== 'OTHER' ||
    !input.reason ||
    pricing.some((p) => p.name.toLocaleLowerCase('vi') === input.name.toLocaleLowerCase('vi'))
  )
    throw commercialConflict('INCIDENTAL_OTHER_REASON_REQUIRED');
  return calculateExpenseLine({
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    unitPriceVnd: input.unitPriceVnd,
    note: input.note ?? null,
    sourceType: 'OTHER',
    reason: input.reason,
  });
}

export async function requireExpenseDraftEditable(client: PrismaClient, bookingId: string) {
  const draft = await client.incidentalExpenseDraft.findUnique({
    where: { bookingId },
    include: { currentReview: true },
  });
  if (draft?.currentReview && draft.currentReview.state !== 'WITHDRAWN')
    throw commercialConflict('EXPENSE_REOPEN_REQUIRED');
}
