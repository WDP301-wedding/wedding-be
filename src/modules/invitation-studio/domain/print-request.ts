import { z } from 'zod';
import { contractLineSchema } from '../../booking-lifecycle/domain/commercial-contract.js';

export const PRINT_COPY_PRICE_VND = 5_000;
const copyQuantity = z.int().min(1).max(10000);
export const printRequestInputSchema = z
  .strictObject({
    lines: z
      .array(
        z.strictObject({
          designId: z.uuid(),
          designRevisionId: z.uuid(),
          quantity: copyQuantity,
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((v) => new Set(v.lines.map((line) => line.designId)).size === v.lines.length, {
    message: 'Select each design once.',
  });
export const printRequestSnapshotLineSchema = z.strictObject({
  designId: z.uuid(),
  designRevisionId: z.uuid(),
  title: z.string(),
  quantity: copyQuantity,
  printableRevisionId: z.uuid(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  line: contractLineSchema,
});
export const printRequestDocumentSchema = z.strictObject({
  predecessorRevisionId: z.uuid(),
  lines: z.array(printRequestSnapshotLineSchema).min(1).max(20),
  totalVnd: z.int().nonnegative(),
});
export const printRequestQuoteSchema = z.strictObject({
  quoteId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.iso.datetime(),
  document: printRequestDocumentSchema,
});
export const printRequestConfirmSchema = z.strictObject({
  quoteId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  consent: z.literal(true),
});
export const printRequestViewSchema = z.strictObject({
  requestId: z.uuid(),
  bookingId: z.uuid(),
  bookingRevision: z.int().positive(),
  appendixRevisionId: z.uuid(),
  state: z.enum(['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED']),
  orderId: z.uuid().nullable(),
  document: printRequestDocumentSchema,
});
export const printRequestResponseSchema = z.strictObject({ data: printRequestViewSchema });
export const printRequestsResponseSchema = z.strictObject({
  data: z.strictObject({ items: z.array(printRequestViewSchema) }),
});
export const withdrawPrintRequestSchema = z.strictObject({ expectedRevision: z.int().positive() });
export type PrintRequestDocument = z.infer<typeof printRequestDocumentSchema>;
export function fixedPrintLine(source: {
  sourceId: string;
  sourceRevisionId: string;
  title: string;
  quantity: number;
}) {
  return contractLineSchema.parse({
    category: 'PRINT',
    sourceId: source.sourceId,
    sourceRevisionId: source.sourceRevisionId,
    name: `In thiệp · ${source.title}`.slice(0, 120),
    description: 'In tiêu chuẩn nhà hàng',
    unit: 'thiệp',
    quantity: copyQuantity.parse(source.quantity),
    unitPriceVnd: PRINT_COPY_PRICE_VND,
    lineTotalVnd: source.quantity * PRINT_COPY_PRICE_VND,
  });
}
