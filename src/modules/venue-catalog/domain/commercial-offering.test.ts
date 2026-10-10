import { describe, expect, it } from 'vitest';
import { checkedLineTotal, createServiceSchema } from './commercial-offering.js';
describe('commercial offering arithmetic and validation', () => {
  const service = {
    name: 'MC',
    description: '',
    unit: 'buổi',
    unitPriceVnd: 2500000,
    active: true,
  };
  it('rejects client totals, fractional VND, negative prices and invalid units', () => {
    for (const patch of [
      { lineTotalVnd: 1 },
      { unitPriceVnd: 0.5 },
      { unitPriceVnd: -1 },
      { unit: ' ' },
    ]) {
      expect(createServiceSchema.safeParse({ ...service, ...patch }).success).toBe(false);
    }
  });
  it('calculates integer totals and rejects overflow or fractional quantities', () => {
    expect(checkedLineTotal(service.unitPriceVnd, 3)).toBe(7500000);
    expect(checkedLineTotal(0, 1)).toBe(0);
    expect(() => checkedLineTotal(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
    expect(() => checkedLineTotal(1, 1.5)).toThrow();
  });
});
