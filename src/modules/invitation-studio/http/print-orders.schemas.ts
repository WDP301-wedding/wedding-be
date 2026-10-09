import { z } from 'zod';
import { id, revision } from '../domain/studio-policy.js';
import {
  PRINT_ORDER_STATUSES,
  MAX_ORDER_TOTAL_VND,
  MAX_LINE_UNIT_PRICE_VND,
  requestPrintOrderBodySchema,
  quotePrintOrderBodySchema,
  approvePrintOrderBodySchema,
  transitionOrderBodySchema,
  handoverOrderBodySchema,
  cancelOrderBodySchema,
  cancellationIntentBodySchema,
  replacementProposalBodySchema,
  replacementApprovalBodySchema,
} from '../domain/print-policy.js';

export {
  requestPrintOrderBodySchema,
  quotePrintOrderBodySchema,
  approvePrintOrderBodySchema,
  transitionOrderBodySchema,
  handoverOrderBodySchema,
  cancelOrderBodySchema,
  cancellationIntentBodySchema,
  replacementProposalBodySchema,
  replacementApprovalBodySchema,
};

export const printLineViewSchema = z.strictObject({
  lineId: id,
  designId: id,
  quantity: z.int().min(1).max(10000),
  printableRevisionId: id.nullable(),
});

export const quotedLineViewSchema = z.strictObject({
  lineId: id,
  designId: id,
  quantity: z.int().min(1).max(10000),
  unitPriceVnd: z.int().min(1).max(MAX_LINE_UNIT_PRICE_VND),
  lineTotalVnd: z.int().min(1),
  designRevisionId: id.optional(),
});

export const commercialRevisionViewSchema = z.strictObject({
  commercialRevisionId: id,
  revisionNumber: revision,
  lines: z.array(quotedLineViewSchema),
  orderTotalVnd: z.number().int().min(1).max(MAX_ORDER_TOTAL_VND),
  estimatedHandoverAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const printOrderViewSchema = z.strictObject({
  orderId: id,
  bookingId: id,
  status: z.enum(PRINT_ORDER_STATUSES),
  revision: revision,
  lines: z.array(printLineViewSchema),
  currentCommercialRevisionId: id.nullable(),
  currentCommercialRevision: commercialRevisionViewSchema.nullable(),
  pendingReplacementProposal: commercialRevisionViewSchema.nullable(),
  receivableChargeId: id.nullable(),
  readyAt: z.iso.datetime().nullable(),
  handedOverAt: z.iso.datetime().nullable(),
  evidenceReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const printOrderListQuerySchema = z.strictObject({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const managementPrintOrderListQuerySchema = z.strictObject({
  bookingId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const printOrderResponseSchema = z.strictObject({
  data: printOrderViewSchema,
});

export const printOrderListResponseSchema = z.strictObject({
  data: z.strictObject({
    items: z.array(printOrderViewSchema).max(100),
    nextCursor: id.nullable(),
  }),
});

export const cancellationIntentResponseSchema = z.strictObject({
  data: z.strictObject({
    confirmed: z.literal(true),
    orderId: id,
  }),
});
