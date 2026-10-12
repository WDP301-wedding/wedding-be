import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { capacityProblem, remapLabels, revisionInput } from './seating-policy.js';

describe('SEA-W1 independent planning and fixed table labels', () => {
  const bounds = { minGuests: 10, maxGuests: 30, totalSeatCapacity: 40, hallMaxGuests: 100 };
  it('accepts inclusive boundaries and rejects zero and physical overflow', () => {
    expect(capacityProblem(10, bounds)).toBeNull();
    expect(capacityProblem(30, bounds)).toBeNull();
    expect(capacityProblem(0, bounds)).toBe('HEADCOUNT_OUTSIDE_LAYOUT_RANGE');
    expect(capacityProblem(31, bounds)).toBe('HEADCOUNT_OUTSIDE_LAYOUT_RANGE');
    expect(capacityProblem(31, bounds, true)).toBeNull();
    expect(capacityProblem(41, bounds, true)).toBe('EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY');
  });
  it('preserves stable IDs, explicitly remaps changed IDs and reports drops', () => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID(),
      group = randomUUID();
    const labels = [
      { layoutTableId: a, guestGroupId: group },
      { layoutTableId: b, guestGroupId: group },
    ];
    expect(remapLabels(labels, [a, c], [])).toEqual({ labels: [labels[0]], droppedTableIds: [b] });
    expect(remapLabels(labels, [a, c], [{ fromTableId: b, toTableId: c }])).toEqual({
      labels: [labels[0], { layoutTableId: c, guestGroupId: group }],
      droppedTableIds: [],
    });
    expect(() => remapLabels(labels, [a], [{ fromTableId: b, toTableId: a }])).toThrow();
    expect(() => remapLabels(labels, [a], [{ fromTableId: c, toTableId: a }])).toThrow();
  });
  it('rejects geometry, personal placement and client group display claims', () => {
    for (const extra of [{ x: 1 }, { guestId: randomUUID() }, { color: '#FFFFFF' }])
      expect(revisionInput.safeParse({ expectedRevision: 1, labels: [], ...extra }).success).toBe(
        false,
      );
    expect(
      revisionInput.safeParse({
        expectedRevision: 1,
        labels: [{ layoutTableId: randomUUID(), guestGroupId: randomUUID(), seat: 1 }],
      }).success,
    ).toBe(false);
  });
});
