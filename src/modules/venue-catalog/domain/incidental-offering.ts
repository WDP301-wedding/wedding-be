import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .overwrite((s) => s.trim().normalize('NFC'))
    .min(1)
    .max(max);
export const createIncidentalOfferingSchema = z.strictObject({
  name: text(120),
  description: text(2000),
  unit: text(80),
  unitPriceVnd: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  chargingRule: text(1000),
  active: z.boolean(),
});
export const reviseIncidentalOfferingSchema = createIncidentalOfferingSchema.extend({
  expectedRevision: z.int().positive(),
});
export const incidentalPriceSchema = createIncidentalOfferingSchema.omit({ active: true }).extend({
  offeringId: z.uuid(),
  revision: z.int().positive(),
});
export const incidentalOfferingViewSchema = incidentalPriceSchema.extend({
  restaurantId: z.uuid(),
  active: z.boolean(),
});
export const incidentalPricingSchema = z.array(incidentalPriceSchema).max(200);
