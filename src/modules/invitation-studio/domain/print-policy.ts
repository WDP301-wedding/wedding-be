import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import { id, revision, studioConflict } from './studio-policy.js';

export const PRINT_ORDER_STATUSES = [
  'REQUESTED',
  'QUOTED',
  'APPROVED',
  'IN_PRODUCTION',
  'READY_FOR_HANDOVER',
  'HANDED_OVER',
  'CANCELLED',
] as const;
export type PrintOrderStatus = (typeof PRINT_ORDER_STATUSES)[number];

export const MAX_ORDER_TOTAL_VND = 1_000_000_000_000;
export const MAX_LINE_UNIT_PRICE_VND = 1_000_000;
export const QUOTE_EXPIRY_DAYS = 7;

const safeText = (max: number, min = 0) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(
      (value) =>
        !/<\/?[a-z!]|(?:https?|data|javascript):|\b(?:accessToken|refreshToken)\b/iu.test(value),
    );

export const printLineRequestSchema = z.strictObject({
  designId: id,
  quantity: z.int().min(1).max(10000),
});

export const requestPrintOrderBodySchema = z.strictObject({
  lines: z.array(printLineRequestSchema).min(1).max(20),
});

export const quoteLineInputSchema = z.strictObject({
  lineId: id,
  unitPriceVnd: z.int().min(1).max(MAX_LINE_UNIT_PRICE_VND),
});

export const quotePrintOrderBodySchema = z.strictObject({
  expectedRevision: revision,
  lines: z.array(quoteLineInputSchema).min(1).max(20),
  estimatedHandoverAt: z.iso.datetime(),
});

export const approvePrintOrderBodySchema = z.strictObject({
  expectedRevision: revision,
  commercialRevisionId: id,
});

export const transitionOrderBodySchema = z.strictObject({
  expectedRevision: revision,
});

export const handoverOrderBodySchema = z.strictObject({
  expectedRevision: revision,
  evidenceReference: safeText(120, 1),
});

export const cancelOrderBodySchema = z.strictObject({
  expectedRevision: revision,
  reason: safeText(500, 1).optional(),
});

export const cancellationIntentBodySchema = z.strictObject({
  expectedRevision: revision,
  reason: safeText(500, 1),
});

export const replacementProposalBodySchema = quotePrintOrderBodySchema;

export const replacementApprovalBodySchema = z.strictObject({
  expectedRevision: revision,
  commercialRevisionId: id,
});

export function printOrderConflict(
  code: string,
  message = 'The print order state conflicts with this command.',
): AppError {
  return new AppError({
    status: 409,
    code,
    message,
  });
}

export interface QuotedLineComputation {
  lineId: string;
  designId: string;
  quantity: number;
  unitPriceVnd: number;
  lineTotalVnd: number;
}

export function computeCommercialTotal(
  linesWithQuantity: { lineId: string; designId: string; quantity: number }[],
  quotes: { lineId: string; unitPriceVnd: number }[],
): { quotedLines: QuotedLineComputation[]; orderTotalVnd: number } {
  if (linesWithQuantity.length !== quotes.length) {
    throw new ValidationError();
  }
  const quoteMap = new Map(quotes.map((q) => [q.lineId, q.unitPriceVnd]));
  let orderTotalVnd = 0;
  const quotedLines: QuotedLineComputation[] = [];

  for (const line of linesWithQuantity) {
    const unitPriceVnd = quoteMap.get(line.lineId);
    if (unitPriceVnd === undefined) {
      throw new ValidationError();
    }
    const lineTotalVnd = line.quantity * unitPriceVnd;
    if (!Number.isSafeInteger(lineTotalVnd) || lineTotalVnd <= 0) {
      throw new ValidationError();
    }
    orderTotalVnd += lineTotalVnd;
    quotedLines.push({
      lineId: line.lineId,
      designId: line.designId,
      quantity: line.quantity,
      unitPriceVnd,
      lineTotalVnd,
    });
  }

  if (
    !Number.isSafeInteger(orderTotalVnd) ||
    orderTotalVnd <= 0 ||
    orderTotalVnd > MAX_ORDER_TOTAL_VND
  ) {
    throw new ValidationError();
  }

  return { quotedLines, orderTotalVnd };
}

export function assertValidEstimatedHandover(estimatedHandoverAt: Date, quoteTime: Date): void {
  if (estimatedHandoverAt.getTime() <= quoteTime.getTime()) {
    throw new ValidationError();
  }
}

export function assertQuoteNotExpired(expiresAt: Date, now: Date): void {
  if (now.getTime() > expiresAt.getTime()) {
    throw studioConflict('PRINT_QUOTE_EXPIRED');
  }
}
