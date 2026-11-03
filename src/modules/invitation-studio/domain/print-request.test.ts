import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { printRequestInputSchema, fixedPrintLine } from './print-request.js';

describe('appendix print request', () => {
  it('accepts distinct saved designs with independent copy quantities', () => {
    const lines = [3, 120].map((quantity) => ({
      designId: randomUUID(),
      designRevisionId: randomUUID(),
      quantity,
    }));
    expect(printRequestInputSchema.parse({ lines }).lines).toEqual(lines);
  });
  it('rejects duplicate designs, client prices and invalid quantities', () => {
    const line = { designId: randomUUID(), designRevisionId: randomUUID(), quantity: 1 };
    expect(printRequestInputSchema.safeParse({ lines: [line, line] }).success).toBe(false);
    for (const quantity of [0, -1, 1.5, 10001])
      expect(printRequestInputSchema.safeParse({ lines: [{ ...line, quantity }] }).success).toBe(
        false,
      );
    expect(
      printRequestInputSchema.safeParse({ lines: [{ ...line, unitPriceVnd: 1 }] }).success,
    ).toBe(false);
  });
  it('prices every design at 5000 integer VND and computes each line on the server', () => {
    const source = {
      sourceId: randomUUID(),
      sourceRevisionId: randomUUID(),
      title: 'Thiệp đỏ',
      quantity: 123,
    };
    expect(fixedPrintLine(source)).toMatchObject({
      category: 'PRINT',
      quantity: 123,
      unitPriceVnd: 5000,
      lineTotalVnd: 615000,
    });
    expect(fixedPrintLine({ ...source, title: 'Thiệp xanh', quantity: 2 }).lineTotalVnd).toBe(
      10000,
    );
  });
});
