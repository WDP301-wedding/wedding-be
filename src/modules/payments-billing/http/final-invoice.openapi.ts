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
  '/bookings/{bookingId}/incidental-expenses': {
    parameters: [booking],
    get: read('getIncidentalExpenses', expenseDraftResponseSchema),
  },
  '/management/bookings/{bookingId}/incidental-expenses': {
    parameters: [booking],
    get: read('getManagementIncidentalExpenses', expenseDraftResponseSchema),
    post: write(
      'createIncidentalExpense',
      'Manager after authoritative event end, CONFIRMED/COMPLETED non-cancelled. Expected draft revision, integer VND; server total and audit. No ledger charge before finalization.',
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
      'Manager after event end. Exact commercial/draft/billing revisions. Freeze original contract, all approved appendices and expenses (including zero). Atomically post only incidental delta, audit/outbox and current invoice.',
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
