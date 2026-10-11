import { describe, expect, it } from 'vitest';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { appendixDraftSchema, calculateAppendixChange } from './commercial-appendix.js';

describe('commercial appendix monetary change', () => {
  it('calculates a signed decrease without repricing the original lines', () => {
    const before = commercialDocumentFixture().lines;
    const after = [{ ...before[0]!, quantity: 9, lineTotalVnd: 31_500_000 }];
    expect(calculateAppendixChange(before, after)).toEqual({
      beforeTotalVnd: 35_000_000,
      afterTotalVnd: 31_500_000,
      deltaVnd: -3_500_000,
      tableCount: 9,
    });
    expect(before[0]!.quantity).toBe(10);
  });
  it('supports increases and zero monetary changes', () => {
    const before = commercialDocumentFixture().lines;
    const after = [{ ...before[0]!, quantity: 11, lineTotalVnd: 38_500_000 }];
    expect(calculateAppendixChange(before, after).deltaVnd).toBe(3_500_000);
    expect(calculateAppendixChange(before, before).deltaVnd).toBe(0);
  });
  it('rejects invented line totals, overflow, duplicates and excess tables', () => {
    const before = commercialDocumentFixture().lines;
    for (const after of [
      [{ ...before[0]!, lineTotalVnd: 1 }],
      [{ ...before[0]!, quantity: 501, lineTotalVnd: 501 * 3_500_000 }],
      [
        {
          ...before[0]!,
          unitPriceVnd: Number.MAX_SAFE_INTEGER,
          lineTotalVnd: Number.MAX_SAFE_INTEGER,
        },
      ],
      [before[0]!, before[0]!],
    ])
      expect(() => calculateAppendixChange(before, after)).toThrow();
  });
  it('requires a reason, exact predecessor and only selection fields from clients', () => {
    const d = commercialDocumentFixture();
    const { category, sourceId, sourceRevisionId, quantity } = d.lines[0]!;
    const input = {
      expectedRevision: 3,
      predecessorRevisionId: d.timelineRevisionId,
      reason: '  Giảm số bàn  ',
      lines: [{ category, sourceId, sourceRevisionId, quantity }],
    };
    expect(appendixDraftSchema.parse(input).reason).toBe('Giảm số bàn');
    for (const extra of [{ deltaVnd: 1 }, { actorAccountId: d.bookingId }, { reason: ' ' }])
      expect(appendixDraftSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
});
