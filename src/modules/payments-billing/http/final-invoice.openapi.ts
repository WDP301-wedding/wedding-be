import type { ZodOpenApiObject } from 'zod-openapi';
import type { z } from 'zod';
import {
  createExpenseSchema,
  updateExpenseSchema,
  deleteExpenseSchema,
  expenseDraftResponseSchema,
  finalizeInvoiceSchema,
  invoiceAdjustmentSchema,
  finalInvoiceResponseSchema,
  expenseReviewCommandSchema,
  expenseReviewDecisionSchema,
  expenseReviewReopenSchema,
} from '../domain/final-invoice.js';
import { finalInvoicesResponseSchema } from './final-invoice.router.js';
const security = [{ bearerAuth: [] }];
const booking = {
  name: 'bookingId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const errors = Object.fromEntries(
  [
    ['400', 'IdempotencyKeyRequired'],
    ['401', 'Unauthorized'],
    ['403', 'Forbidden'],
    ['404', 'NotFound'],
    ['409', 'Conflict'],
    ['422', 'UnprocessableEntity'],
    ['503', 'ServiceUnavailable'],
  ].map(([status, name]) => [status!, { $ref: `#/components/responses/${name}` }] as const),
);
const result = (schema: z.ZodType) => ({
  description: 'Private no-store owner snapshot.',
  content: { 'application/json': { schema } },
  headers: { 'Cache-Control': { schema: { type: 'string' as const, const: 'no-store' } } },
});
function read(operationId: string, schema: z.ZodType) {
  return {
    operationId,
    tags: ['Payments and Billing'],
    security,
    description: 'Manager or authorized FULL Couple. Staff and cross-booking access denied.',
    responses: { '200': result(schema), ...errors },
  };
}
function write(
  operationId: string,
  description: string,
  body: z.ZodType,
  response: z.ZodType,
  status = '201',
) {
  return {
    operationId,
    description,
    tags: ['Payments and Billing'],
    security,
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    requestBody: { required: true, content: { 'application/json': { schema: body } } },
    responses: { [status]: result(response), ...errors },
  };
}
export const finalInvoiceOpenApiPaths = {
  ...Object.fromEntries(
    ['submit', 'no-expenses', 'reopen', 'adjustment-proposals'].map((action) => [
      '/management/bookings/{bookingId}/incidental-expenses/' + action,
      {
        parameters: [booking],
        post: write(
          'incidental' +
            action
              .split('-')
              .map((s) => s[0]!.toUpperCase() + s.slice(1))
              .join(''),
          'Assigned Manager, COMPLETED; frozen booking prices and exact expense revision. Submission records Manager approval; no-expenses requires explicit empty declaration; reopen retains evidence with reason. Adjustment proposals bind invoice and billing versions. Legacy bookings retain their prior workflow.',
          action === 'reopen'
            ? expenseReviewReopenSchema
            : action === 'adjustment-proposals'
              ? invoiceAdjustmentSchema
              : expenseReviewCommandSchema,
          expenseDraftResponseSchema,
          '200',
        ),
      },
    ]),
  ),
  '/bookings/{bookingId}/incidental-expenses/decisions': {
    parameters: [booking],
    post: write(
      'decideIncidentalExpenses',
      'Owning FULL Couple approves the exact current digest or requests changes with reason; any content change requires a successor. Staff and Manager cannot decide for Couple.',
      expenseReviewDecisionSchema,
      expenseDraftResponseSchema,
      '200',
    ),
  },
  '/bookings/{bookingId}/incidental-expenses': {
    parameters: [booking],
    get: read('getIncidentalExpenses', expenseDraftResponseSchema),
  },
  '/management/bookings/{bookingId}/incidental-expenses': {
    parameters: [booking],
    get: read('getManagementIncidentalExpenses', expenseDraftResponseSchema),
    post: write(
      'createIncidentalExpense',
      'Manager, COMPLETED only. Manager must mark the event completed before settlement, even in demo mode. Demo date bypass remains; STRICT_SETTLEMENT_DATE_CHECK=true additionally requires authoritative event end. Expected draft revision, integer VND; server total and audit. No ledger charge before finalization.',
      createExpenseSchema,
      expenseDraftResponseSchema,
    ),
  },
  '/management/bookings/{bookingId}/incidental-expenses/{lineId}': {
    parameters: [booking, { ...booking, name: 'lineId' }],
    patch: write(
      'updateIncidentalExpense',
      'Manager edits mutable draft at expected revision. Finalized lines are locked.',
      updateExpenseSchema,
      expenseDraftResponseSchema,
      '200',
    ),
    delete: write(
      'deleteIncidentalExpense',
      'Manager removes draft line with expected revision in JSON body; immutable finalized invoice unaffected.',
      deleteExpenseSchema,
      expenseDraftResponseSchema,
      '200',
    ),
  },
  '/management/bookings/{bookingId}/final-invoices': {
    parameters: [booking],
    post: write(
      'finalizeCommercialInvoice',
      'Manager, COMPLETED only. Manager must mark the event completed before settlement, even in demo mode. Demo date bypass remains; STRICT_SETTLEMENT_DATE_CHECK=true additionally requires authoritative event end. Exact commercial/draft/billing revisions. Freeze original contract, all approved appendices and expenses (including zero). Atomically post only incidental delta, audit/outbox and current invoice.',
      finalizeInvoiceSchema,
      finalInvoiceResponseSchema,
    ),
  },
  '/management/bookings/{bookingId}/invoice-adjustments': {
    parameters: [booking],
    post: write(
      'adjustCommercialInvoice',
      'Manager reasoned debit/credit successor on exact invoice/billing versions. Original document immutable, total nonnegative; unresolved payment blocks monetary changes. Credit is distinct from an executed refund.',
      invoiceAdjustmentSchema,
      finalInvoiceResponseSchema,
    ),
  },
  '/bookings/{bookingId}/final-invoices': {
    parameters: [booking],
    get: {
      ...read('listCommercialInvoices', finalInvoicesResponseSchema),
      parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string', format: 'uuid' } }],
    },
  },
  '/bookings/{bookingId}/final-invoices/{invoiceRevisionId}': {
    parameters: [booking, { ...booking, name: 'invoiceRevisionId' }],
    get: read('getCommercialInvoice', finalInvoiceResponseSchema),
  },
} satisfies ZodOpenApiObject['paths'];
