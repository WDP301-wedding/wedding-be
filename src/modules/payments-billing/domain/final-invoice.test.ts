import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  expenseLineSchema,
  calculateExpenseLine,
  signedAdjustmentTotal,
  finalizeInvoiceSchema,
} from './final-invoice.js';
const expense = {
  name: 'Bia thêm',
  quantity: 3,
  unit: 'thùng',
  unitPriceVnd: 350000,
  note: 'Phát sinh cuối tiệc',
};
it('calculates incidental lines on the server, including free items and checked overflow', () => {
  expect(calculateExpenseLine(expense).totalVnd).toBe(1050000);
  expect(calculateExpenseLine({ ...expense, unitPriceVnd: 0 }).totalVnd).toBe(0);
  for (const patch of [
    { quantity: 0 },
    { quantity: 1.5 },
    { unitPriceVnd: 1.5 },
    { totalVnd: 1 },
    { actor: 'MANAGER' },
  ])
    expect(expenseLineSchema.safeParse({ ...expense, ...patch }).success).toBe(false);
  expect(() =>
    calculateExpenseLine({ ...expense, unitPriceVnd: Number.MAX_SAFE_INTEGER }),
  ).toThrow();
  expect(calculateExpenseLine({ ...expense, name: '  Bàn  ' }).name).toBe('Bàn');
});
it('retains a signed correction and permits zero-expense finalization with exact predecessors', () => {
  expect(
    signedAdjustmentTotal([
      { ...expense, kind: 'DEBIT' },
      { ...expense, kind: 'CREDIT', quantity: 4 },
    ]),
  ).toBe(-350000);
  expect(
    finalizeInvoiceSchema.safeParse({
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: randomUUID(),
      expectedBillingRevision: 2,
    }).success,
  ).toBe(true);
});
