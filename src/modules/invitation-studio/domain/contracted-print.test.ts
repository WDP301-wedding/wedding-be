import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { requireContractedPrint } from './contracted-print.js';
const binding = {
  agreementRevisionId: randomUUID(),
  offeringId: randomUUID(),
  sourceRevisionId: randomUUID(),
};
const line = {
  sourceId: binding.offeringId,
  sourceRevisionId: binding.sourceRevisionId,
  quantity: 100,
  unitPriceVnd: 5000,
};
it('uses an exact approved source and prevents reused quantity across orders', () => {
  expect(requireContractedPrint(binding, binding.agreementRevisionId, line, 40, 60, 5000)).toBe(
    200000,
  );
  for (const [quantity, used, price] of [
    [41, 60, 5000],
    [40, 60, 1],
    [0, 0, 5000],
  ])
    expect(() =>
      requireContractedPrint(binding, binding.agreementRevisionId, line, quantity!, used!, price!),
    ).toThrow();
  expect(() => requireContractedPrint(binding, randomUUID(), line, 40, 0, 5000)).toThrow();
  expect(() =>
    requireContractedPrint(
      binding,
      binding.agreementRevisionId,
      { ...line, sourceRevisionId: randomUUID() },
      40,
      0,
      5000,
    ),
  ).toThrow();
});
