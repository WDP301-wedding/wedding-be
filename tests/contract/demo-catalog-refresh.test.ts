import { describe, expect, it } from 'vitest';
import {
  buildDemoLayoutPlans,
  stableDemoId,
  verifyDemoLayout,
} from '../../scripts/demo-catalog-refresh.js';
import { createImmutableLayout } from '../../src/modules/venue-catalog/domain/catalog-policy.js';

const halls = [
  { id: '10000000-0000-4000-8000-000000000010', name: 'Lotus Hall', maxGuests: 300 },
  { id: '10000000-0000-4000-8000-000000000011', name: 'Orchid Hall', maxGuests: 120 },
  { id: 'be5d4496-de6a-4666-8d17-3202b1f873ed', name: 'Sảnh Demo — Tiệc thân mật', maxGuests: 120 },
];

describe('reusable demo seating catalog', () => {
  it('covers each hall continuously with realistic non-overlapping tables and stable IDs', () => {
    const plans = buildDemoLayoutPlans(halls);
    expect(plans).toHaveLength(9);
    expect(buildDemoLayoutPlans(halls)).toEqual(plans);
    for (const hall of halls) {
      const layouts = plans.filter((p) => p.hallId === hall.id);
      let next = 1;
      for (const layout of layouts) {
        expect(layout.minGuests).toBe(next);
        const checked = createImmutableLayout({
          ...layout,
          hallMaximumGuests: hall.maxGuests,
          registeredTableIds: layout.tables.map((t) => t.tableId),
          retiredTableIds: [],
        });
        expect(checked.totalSeatCapacity).toBe(layout.maxGuests);
        expect(layout.tables.every((t) => t.seatCapacity === 10)).toBe(true);
        expect(layout.name).not.toMatch(/PERF/u);
        for (const [i, a] of layout.tables.entries()) {
          for (const b of layout.tables.slice(i + 1)) {
            expect(
              a.x + a.width <= b.x ||
                b.x + b.width <= a.x ||
                a.y + a.height <= b.y ||
                b.y + b.height <= a.y,
            ).toBe(true);
          }
        }
        next = layout.maxGuests + 1;
      }
      expect(next).toBe(hall.maxGuests + 1);
    }
    expect(new Set(plans.flatMap((p) => p.tables.map((t) => t.tableId))).size).toBe(
      plans.reduce((n, p) => n + p.tables.length, 0),
    );
    expect(stableDemoId('sample')).toMatch(/^[a-f0-9-]{14}5[a-f0-9-]{21}$/u);
  });

  it('refuses a changed hall capacity instead of silently changing the approved seed', () => {
    expect(() => buildDemoLayoutPlans([{ ...halls[0]!, maxGuests: 90 }])).toThrow(
      'DEMO_HALL_CONFLICT',
    );
  });

  it('rejects Manager edits on replay and accepts the exact existing layout', () => {
    const plan = buildDemoLayoutPlans(halls)[0]!;
    expect(() => verifyDemoLayout(plan, plan)).not.toThrow();
    expect(() => verifyDemoLayout(plan, { ...plan, name: 'Manager edit' })).toThrow(
      'DEMO_LAYOUT_CONFLICT',
    );
    expect(() => verifyDemoLayout(plan, { ...plan, tables: plan.tables.slice(1) })).toThrow(
      'DEMO_LAYOUT_CONFLICT',
    );
    expect(() =>
      verifyDemoLayout(plan, {
        ...plan,
        tables: plan.tables.map((t, i) => (i === 0 ? { ...t, seatCapacity: 9 } : t)),
      }),
    ).toThrow('DEMO_LAYOUT_CONFLICT');
  });
});
