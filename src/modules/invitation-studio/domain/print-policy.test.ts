import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ValidationError, AppError } from '../../../core/errors/app-error.js';
import {
  computeCommercialTotal,
  assertValidEstimatedHandover,
  assertQuoteNotExpired,
  requestPrintOrderBodySchema,
  quotePrintOrderBodySchema,
  handoverOrderBodySchema,
  MAX_LINE_UNIT_PRICE_VND,
} from './print-policy.js';

describe('Print Policy Domain', () => {
  const lineId1 = randomUUID();
  const lineId2 = randomUUID();
  const designId1 = randomUUID();
  const designId2 = randomUUID();

  describe('computeCommercialTotal', () => {
    it('fulfills zero-priced and large frozen contract lines while retaining legacy quote limits', () => {
      const lines = [{ lineId: lineId1, designId: designId1, quantity: 60 }];
      for (const price of [0, 20_000_000_000]) {
        const quotes = [{ lineId: lineId1, unitPriceVnd: price }];
        expect(computeCommercialTotal(lines, quotes, true).orderTotalVnd).toBe(60 * price);
        expect(() => computeCommercialTotal(lines, quotes)).toThrow(ValidationError);
      }
      expect(() =>
        computeCommercialTotal(
          lines,
          [{ lineId: lineId1, unitPriceVnd: Number.MAX_SAFE_INTEGER }],
          true,
        ),
      ).toThrow(ValidationError);
    });
    it('rejects invalid VND unit prices and overflow when combining safe contract lines', () => {
      const lines = [{ lineId: lineId1, designId: designId1, quantity: 1 }];
      for (const contracted of [false, true]) {
        for (const unitPriceVnd of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
          expect(() =>
            computeCommercialTotal(lines, [{ lineId: lineId1, unitPriceVnd }], contracted),
          ).toThrow(ValidationError);
      }
      expect(() =>
        computeCommercialTotal(
          [...lines, { lineId: lineId2, designId: designId2, quantity: 1 }],
          [
            { lineId: lineId1, unitPriceVnd: Number.MAX_SAFE_INTEGER },
            { lineId: lineId2, unitPriceVnd: 1 },
          ],
          true,
        ),
      ).toThrow(ValidationError);
    });
    it('calculates correct line and order totals for valid inputs', () => {
      const lines = [
        { lineId: lineId1, designId: designId1, quantity: 50 },
        { lineId: lineId2, designId: designId2, quantity: 100 },
      ];
      const quotes = [
        { lineId: lineId1, unitPriceVnd: 10000 },
        { lineId: lineId2, unitPriceVnd: 15000 },
      ];

      const result = computeCommercialTotal(lines, quotes);
      expect(result.orderTotalVnd).toBe(50 * 10000 + 100 * 15000);
      expect(result.quotedLines).toHaveLength(2);
      expect(result.quotedLines[0]).toEqual({
        lineId: lineId1,
        designId: designId1,
        quantity: 50,
        unitPriceVnd: 10000,
        lineTotalVnd: 500000,
      });
      expect(result.quotedLines[1]).toEqual({
        lineId: lineId2,
        designId: designId2,
        quantity: 100,
        unitPriceVnd: 15000,
        lineTotalVnd: 1500000,
      });
    });

    it('throws ValidationError when quote lineIds do not match order lineIds', () => {
      const lines = [{ lineId: lineId1, designId: designId1, quantity: 50 }];
      const quotes = [{ lineId: randomUUID(), unitPriceVnd: 10000 }];

      expect(() => computeCommercialTotal(lines, quotes)).toThrow(ValidationError);
    });

    it('throws ValidationError when quotes length differs from lines length', () => {
      const lines = [
        { lineId: lineId1, designId: designId1, quantity: 50 },
        { lineId: lineId2, designId: designId2, quantity: 100 },
      ];
      const quotes = [{ lineId: lineId1, unitPriceVnd: 10000 }];

      expect(() => computeCommercialTotal(lines, quotes)).toThrow(ValidationError);
    });

    it('throws ValidationError when total exceeds MAX_ORDER_TOTAL_VND', () => {
      const lines = [{ lineId: lineId1, designId: designId1, quantity: 10000 }];
      const quotes = [{ lineId: lineId1, unitPriceVnd: MAX_LINE_UNIT_PRICE_VND }];
      // 10000 * 1_000_000 = 10_000_000_000 (10 billion, below 1 trillion)
      expect(computeCommercialTotal(lines, quotes).orderTotalVnd).toBe(10_000_000_000);

      // Artificially large mock quantity to exceed 1 trillion
      const hugeLines = [{ lineId: lineId1, designId: designId1, quantity: 2_000_000_000 }];
      const hugeQuotes = [{ lineId: lineId1, unitPriceVnd: 1000 }];
      expect(() => computeCommercialTotal(hugeLines, hugeQuotes)).toThrow(ValidationError);
    });
  });

  describe('assertValidEstimatedHandover', () => {
    it('accepts future estimated handover date', () => {
      const now = new Date('2026-10-09T10:00:00Z');
      const future = new Date('2026-10-10T10:00:00Z');
      expect(() => assertValidEstimatedHandover(future, now)).not.toThrow();
    });

    it('throws ValidationError when estimated handover is equal or in past', () => {
      const now = new Date('2026-10-09T10:00:00Z');
      const past = new Date('2026-10-08T10:00:00Z');
      expect(() => assertValidEstimatedHandover(now, now)).toThrow(ValidationError);
      expect(() => assertValidEstimatedHandover(past, now)).toThrow(ValidationError);
    });
  });

  describe('assertQuoteNotExpired', () => {
    it('accepts when current time is before or equal to expiry', () => {
      const expiry = new Date('2026-10-16T10:00:00Z');
      const now = new Date('2026-10-09T10:00:00Z');
      expect(() => assertQuoteNotExpired(expiry, now)).not.toThrow();
      expect(() => assertQuoteNotExpired(expiry, expiry)).not.toThrow();
    });

    it('throws 409 PRINT_QUOTE_EXPIRED when current time is after expiry', () => {
      const expiry = new Date('2026-10-09T10:00:00Z');
      const now = new Date('2026-10-09T10:00:01Z');
      try {
        assertQuoteNotExpired(expiry, now);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(409);
        expect((err as AppError).code).toBe('PRINT_QUOTE_EXPIRED');
      }
    });
  });

  describe('Zod Schemas', () => {
    it('validates requestPrintOrderBodySchema bounds', () => {
      const valid = {
        lines: [
          { designId: randomUUID(), quantity: 1 },
          { designId: randomUUID(), quantity: 10000 },
        ],
      };
      expect(requestPrintOrderBodySchema.safeParse(valid).success).toBe(true);

      // Empty lines
      expect(requestPrintOrderBodySchema.safeParse({ lines: [] }).success).toBe(false);

      // Quantity 0
      expect(
        requestPrintOrderBodySchema.safeParse({
          lines: [{ designId: randomUUID(), quantity: 0 }],
        }).success,
      ).toBe(false);

      // Quantity > 10000
      expect(
        requestPrintOrderBodySchema.safeParse({
          lines: [{ designId: randomUUID(), quantity: 10001 }],
        }).success,
      ).toBe(false);

      // More than 20 lines
      const tooManyLines = Array.from({ length: 21 }, () => ({
        designId: randomUUID(),
        quantity: 10,
      }));
      expect(requestPrintOrderBodySchema.safeParse({ lines: tooManyLines }).success).toBe(false);
    });

    it('validates quotePrintOrderBodySchema price bounds', () => {
      const valid = {
        expectedRevision: 1,
        lines: [{ lineId: randomUUID(), unitPriceVnd: 50000 }],
        estimatedHandoverAt: '2026-10-20T00:00:00Z',
      };
      expect(quotePrintOrderBodySchema.safeParse(valid).success).toBe(true);

      // Contract fulfillment permits zero; legacy policy is checked by the service.
      expect(
        quotePrintOrderBodySchema.safeParse({
          ...valid,
          lines: [{ lineId: randomUUID(), unitPriceVnd: 0 }],
        }).success,
      ).toBe(true);

      // Contract fulfillment uses the frozen catalog price beyond the legacy cap.
      expect(
        quotePrintOrderBodySchema.safeParse({
          ...valid,
          lines: [{ lineId: randomUUID(), unitPriceVnd: 1000001 }],
        }).success,
      ).toBe(true);
    });

    it('validates handoverOrderBodySchema evidence bounds', () => {
      const valid = {
        expectedRevision: 1,
        evidenceReference: 'SHIPPING-TRACKING-12345',
      };
      expect(handoverOrderBodySchema.safeParse(valid).success).toBe(true);

      // Empty evidence
      expect(
        handoverOrderBodySchema.safeParse({
          expectedRevision: 1,
          evidenceReference: '',
        }).success,
      ).toBe(false);

      // Evidence too long (> 120)
      expect(
        handoverOrderBodySchema.safeParse({
          expectedRevision: 1,
          evidenceReference: 'x'.repeat(121),
        }).success,
      ).toBe(false);
    });
  });
});
