import { z } from 'zod';

const text = (max: number, min: number) =>
  z
    .string()
    .overwrite((value) => value.trim().normalize('NFC'))
    .min(min)
    .max(max);
export const serviceFields = {
  name: text(120, 1),
  description: text(2000, 0),
  unit: text(80, 1),
  unitPriceVnd: z.int().nonnegative(),
  active: z.boolean(),
};
export const createServiceSchema = z.strictObject(serviceFields);
const offeringViewFields = {
  sourceRevisionId: z.uuid(),
  restaurantId: z.uuid(),
  revision: z.int().positive(),
};
export const serviceViewSchema = createServiceSchema.extend({
  serviceId: z.uuid(),
  ...offeringViewFields,
});
export const printFields = {
  name: text(120, 1),
  printType: text(80, 1),
  material: text(120, 1),
  templateId: z.uuid(),
  templateVersionId: z.uuid(),
  unitPriceVnd: z.int().nonnegative(),
  active: z.boolean(),
};
export const createPrintOfferingSchema = z.strictObject(printFields);
export const printOfferingViewSchema = createPrintOfferingSchema.extend({
  offeringId: z.uuid(),
  ...offeringViewFields,
  templateTitle: z.string().min(1).max(120),
  unit: z.literal('copy'),
});
export const revisePrintOfferingSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  ...printFields,
});
export const printSelectionSchema = z.strictObject({
  offeringId: z.uuid(),
  sourceRevisionId: z.uuid(),
  quantity: z.int().positive(),
});
export const reviseServiceSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  ...serviceFields,
});
export const serviceSelectionSchema = z.strictObject({
  serviceId: z.uuid(),
  sourceRevisionId: z.uuid(),
  quantity: z.int().positive(),
});

export function checkedLineTotal(unitPriceVnd: number, quantity: number): number {
  z.int().nonnegative().parse(unitPriceVnd);
  z.int().positive().parse(quantity);
  const total = BigInt(unitPriceVnd) * BigInt(quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('The VND line total exceeds the safe integer range.');
  return Number(total);
}
