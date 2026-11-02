import { z } from 'zod';
import { id } from './studio-policy.js';
import { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';

export const printPurchaseInputSchema = z.strictObject({
  designId: id,
  designRevisionId: id,
  offeringId: id,
  sourceRevisionId: id,
  quantity: z.int().min(1).max(10000),
});
export const printPurchaseDocumentSchema = printPurchaseInputSchema.extend({
  predecessorRevisionId: id,
  printableRevisionId: id,
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  line: contractLineSchema,
  material: z.string(),
  printType: z.string(),
  templateVersionId: id,
});
export const printPurchaseQuoteSchema = z.strictObject({
  quoteId: id,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.iso.datetime(),
  document: printPurchaseDocumentSchema,
});
export const printPurchaseConfirmSchema = z.strictObject({
  quoteId: id,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  consent: z.literal(true),
});
export const printPurchaseMetadataSchema = z.strictObject({
  cancellationRequested: z.boolean().optional(),
  appendixRevisionId: id,
  quoteId: id,
  material: z.string(),
  printType: z.string(),
  cancellationAppendixRevisionId: id.nullable(),
});

export const printPurchaseAccessSchema = z.strictObject({
  canOrder: z.boolean(),
  legacy: z.boolean(),
  blockReason: z.string().nullable(),
});
