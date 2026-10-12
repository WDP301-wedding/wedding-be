import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';
export const id = z.uuid().overwrite((v) => v.toLowerCase());
export const revision = z.int().positive();
export const labelInput = z.strictObject({ layoutTableId: id, guestGroupId: id });
export const remapInput = z.strictObject({ fromTableId: id, toTableId: id.nullable() });
export const selectInput = z.strictObject({
  layoutTemplateVersionId: id,
  expectedBookingRevision: revision,
});
export const revisionInput = z
  .strictObject({
    expectedRevision: revision,
    labels: z.array(labelInput).max(500).optional(),
    layoutTemplateVersionId: id.optional(),
    remap: z.array(remapInput).max(500).optional(),
  })
  .refine((v) => v.remap === undefined || v.layoutTemplateVersionId !== undefined);
export const confirmationInput = z.strictObject({
  expectedRevision: revision,
  expectedBookingRevision: revision,
});
export const exceptionInput = confirmationInput.extend({
  reason: z.string().trim().normalize('NFC').min(10).max(500),
});
export const labelSnapshot = labelInput.extend({
  groupName: z.string().min(1).max(80),
  colorSnapshot: z.string().regex(/^#[A-F0-9]{6}$/u),
});
export const conflict = (code: string) =>
  new AppError({
    status: 409,
    code,
    message: 'The seating plan conflicts with current owner facts.',
  });
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError();
  return result.data;
}
export function capacityProblem(
  count: number,
  bounds: {
    minGuests: number;
    maxGuests: number;
    totalSeatCapacity: number;
    hallMaxGuests: number;
  },
  exception = false,
) {
  if (count > Math.min(bounds.hallMaxGuests, bounds.totalSeatCapacity))
    return 'EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY';
  if (count < 1 || (!exception && (count < bounds.minGuests || count > bounds.maxGuests)))
    return 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE';
  return null;
}
export function remapLabels<T extends z.infer<typeof labelInput>>(
  labels: readonly T[],
  tableIds: readonly string[],
  mappings: readonly z.infer<typeof remapInput>[],
) {
  if (
    new Set(mappings.map((v) => v.fromTableId)).size !== mappings.length ||
    mappings.some((v) => !labels.some((l) => l.layoutTableId === v.fromTableId))
  )
    throw conflict('TABLE_NOT_IN_LAYOUT');
  const droppedTableIds: string[] = [],
    result: T[] = [];
  for (const label of labels) {
    const mapping = mappings.find((v) => v.fromTableId === label.layoutTableId);
    const target =
      mapping === undefined
        ? tableIds.includes(label.layoutTableId)
          ? label.layoutTableId
          : null
        : mapping.toTableId;
    if (target === null) droppedTableIds.push(label.layoutTableId);
    else {
      if (!tableIds.includes(target) || result.some((v) => v.layoutTableId === target))
        throw conflict('TABLE_NOT_IN_LAYOUT');
      result.push({ ...label, layoutTableId: target });
    }
  }
  return { labels: result, droppedTableIds };
}
