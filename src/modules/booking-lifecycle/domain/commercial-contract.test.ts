import { describe, expect, it } from 'vitest';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import {
  checkedSum,
  contractDeposit,
  contractDraftSchema,
  deepFreeze,
  documentDigest,
} from './commercial-contract.js';
describe('commercial contract arithmetic and canonical identity', () => {
  it('sums exact integer VND and detects overflow', () => {
    expect(checkedSum([35000000, 9000000, 2500000, 500000])).toBe(47000000);
    expect(checkedSum([])).toBe(0);
    expect(() => checkedSum([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      expect.objectContaining({ code: 'COMMERCIAL_AMOUNT_OVERFLOW' }),
    );
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => checkedSum([invalid])).toThrow();
  });
  it.each([
    [1, 1],
    [2, 1],
    [10, 3],
    [11, 4],
    [47000000, 14100000],
  ])('rounds 30 percent upward for %i', (total, expected) => {
    expect(contractDeposit(total)).toBe(expected);
  });
  it('rejects nonpositive or fractional deposit bases', () => {
    for (const invalid of [0, -1, 0.5]) expect(() => contractDeposit(invalid)).toThrow();
  });
  it('hashes schema-canonical fields independently of input object order', () => {
    const d = commercialDocumentFixture();
    const { lines, ...otherFields } = d;
    expect(documentDigest(d)).toBe(documentDigest({ lines, ...otherFields }));
    expect(documentDigest({ ...d, groomName: 'Tên đã đổi' })).not.toBe(documentDigest(d));
  });
  it('requires distinct selections and at least one menu', () => {
    const d = commercialDocumentFixture();
    const line = d.lines[0]!;
    const body = {
      expectedRevision: 1,
      predecessorRevisionId: null,
      timelineRevisionId: d.timelineRevisionId,
      lines: [
        {
          category: line.category,
          sourceId: line.sourceId,
          sourceRevisionId: line.sourceRevisionId,
          quantity: line.quantity,
        },
      ],
    };
    expect(contractDraftSchema.safeParse(body).success).toBe(true);
    expect(
      contractDraftSchema.safeParse({ ...body, lines: [body.lines[0], body.lines[0]] }).success,
    ).toBe(false);
    expect(
      contractDraftSchema.safeParse({ ...body, lines: [{ ...body.lines[0], category: 'SERVICE' }] })
        .success,
    ).toBe(false);
  });
  it('freezes nested objects and safely handles primitives, null and already frozen values', () => {
    const value = { items: [{ name: 'frozen' }], empty: null, number: 1 };
    expect(deepFreeze(value)).toBe(value);
    expect(Object.isFrozen(value.items[0])).toBe(true);
    expect(deepFreeze(value)).toBe(value);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(1)).toBe(1);
  });
});
