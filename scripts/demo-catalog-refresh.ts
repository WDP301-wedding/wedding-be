import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createLayoutBodySchema } from '../src/modules/venue-catalog/http/venue-catalog.schemas.js';

export const DEMO_HALL_RENAME = Object.freeze({
  id: 'be5d4496-de6a-4666-8d17-3202b1f873ed',
  before: 'PERF-TEST Staff event and Storage',
  after: 'Sảnh Demo — Tiệc thân mật',
  description:
    'Sảnh mẫu cho tiệc thân mật và thực hành vận hành. Dữ liệu giả lập, không phải sự kiện khách hàng.',
});

export const DEMO_CONSULTATION_RENAMES = Object.freeze([
  {
    id: '52f0225b-8069-4140-a849-0146ef86e04b',
    bookingId: 'e80c6f1b-a4fc-4674-a4dd-13ef2601206b',
    before: 'PERF-TEST-20261016',
    after: 'DEMO — Tiệc Orchid 50 khách',
  },
  {
    id: 'dc8b7116-36d7-4e28-b848-e03fb8c0383f',
    bookingId: '984bd852-462f-4ede-854a-436b108a1851',
    before: 'PERF-TEST-20261017-STAFF',
    after: 'DEMO — Thực hành vận hành 50 khách',
  },
]);

export const DEMO_LAYOUT_RENAMES = Object.freeze([
  {
    templateId: '2e65cdee-d43c-4df0-8d65-9583939f4f15',
    sourceVersionId: '71b4c5e4-cfcd-49ee-8815-a692b892d8cd',
    hallId: '10000000-0000-4000-8000-000000000011',
    name: 'Orchid — 5 bàn, 50 chỗ (demo)',
  },
  {
    templateId: '76191cc8-faee-4248-b709-e011752512fe',
    sourceVersionId: '3060b9f4-2ed1-4664-9f9f-3f2b3428d885',
    hallId: DEMO_HALL_RENAME.id,
    name: 'Tiệc thân mật — 5 bàn, 50 chỗ (demo)',
  },
]);

export const demoHallSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  maxGuests: z.int().positive(),
  displayOrder: z.int(),
  revision: z.int().positive(),
  lifecycle: z.enum(['ACTIVE', 'RETIRED']),
});
export const demoLayoutVersionSchema = z.object({
  id: z.uuid(),
  revision: z.int().positive(),
  state: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']),
  name: z.string(),
  description: z.string(),
  minGuests: z.int(),
  maxGuests: z.int(),
  tables: z.array(createLayoutBodySchema.shape.tables.element),
});
export const demoLayoutAggregateSchema = z.object({
  id: z.uuid(),
  hallId: z.uuid(),
  lifecycle: z.enum(['ACTIVE', 'RETIRED']),
  currentPublishedVersionId: z.uuid().nullable(),
  draftVersionId: z.uuid().nullable(),
  versions: z.array(demoLayoutVersionSchema),
});
export type DemoLayoutPlan = z.infer<typeof createLayoutBodySchema>;

export function stableDemoId(key: string): string {
  const hex = createHash('sha256').update(`wedding-demo-catalog-v1/${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildDemoLayoutPlans(
  halls: readonly { id: string; name: string; maxGuests: number }[],
): DemoLayoutPlan[] {
  return halls.flatMap((hall) => {
    const lotus = hall.id === '10000000-0000-4000-8000-000000000010';
    const orchid = hall.id === '10000000-0000-4000-8000-000000000011';
    if (
      (!lotus && !orchid && hall.id !== DEMO_HALL_RENAME.id) ||
      hall.maxGuests !== (lotus ? 300 : 120)
    ) {
      throw Error('DEMO_HALL_CONFLICT');
    }
    const sizes = lotus ? [10, 20, 30] : [5, 10, 12];
    const label = lotus ? 'Lotus' : orchid ? 'Orchid' : 'Tiệc thân mật';
    let minimum = 1;
    return sizes.map((count, index) => {
      const key = `${hall.id}/${count}`;
      const columns = count >= 20 ? 6 : 4;
      const plan = createLayoutBodySchema.parse({
        templateId: stableDemoId(`${key}/template`),
        versionId: stableDemoId(`${key}/version`),
        hallId: hall.id,
        displayOrder: 10 + index,
        name: `${label} — ${count} bàn, ${count * 10} chỗ`,
        description:
          'Mẫu demo, bàn tròn 10 chỗ. Phía trên chừa sân khấu; khoảng giữa chừa lối đi. Số khách dự kiến do Couple/Manager nhập riêng.',
        minGuests: minimum,
        maxGuests: count * 10,
        tables: Array.from({ length: count }, (_, i) => ({
          tableId: stableDemoId(`${key}/table/${i + 1}`),
          label: `Bàn ${String(i + 1).padStart(2, '0')}`,
          shape: 'ROUND',
          seatCapacity: 10,
          x: 600 + (i % columns) * 1100 + (i % columns >= columns / 2 ? 1200 : 0),
          y: 2000 + Math.floor(i / columns) * 1200,
          width: 650,
          height: 650,
          rotationDegrees: 0,
          displayOrder: i + 1,
        })),
      });
      minimum = count * 10 + 1;
      return plan;
    });
  });
}

/** Ignore server metadata, but never overwrite content changed by a Manager. */
export function verifyDemoLayout(
  expected: Pick<DemoLayoutPlan, 'name' | 'description' | 'minGuests' | 'maxGuests' | 'tables'>,
  actual: unknown,
): void {
  const content = createLayoutBodySchema
    .pick({ name: true, description: true, minGuests: true, maxGuests: true, tables: true })
    .strip();
  if (JSON.stringify(content.parse(expected)) !== JSON.stringify(content.parse(actual))) {
    throw Error('DEMO_LAYOUT_CONFLICT');
  }
}
