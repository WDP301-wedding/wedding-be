import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
export const commercialPrintSourceSchema = z.strictObject({
  agreementRevisionId: z.uuid(),
  offeringId: z.uuid(),
  sourceRevisionId: z.uuid(),
});
export const commercialPrintSnapshotSchema = commercialPrintSourceSchema.extend({
  templateVersionId: z.uuid(),
  material: z.string(),
  printType: z.string(),
  unitPriceVnd: z.int().nonnegative(),
});
export type CommercialPrintSource = z.infer<typeof commercialPrintSourceSchema>;
export function requireContractedPrint(
  binding: CommercialPrintSource,
  effectiveRevisionId: string,
  line: { sourceId: string; sourceRevisionId: string; quantity: number; unitPriceVnd: number },
  quantity: number,
  allocated: number,
  quotedUnitPriceVnd: number,
) {
  if (
    binding.agreementRevisionId !== effectiveRevisionId ||
    line.sourceId !== binding.offeringId ||
    line.sourceRevisionId !== binding.sourceRevisionId ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    !Number.isSafeInteger(allocated) ||
    allocated < 0 ||
    quantity + allocated > line.quantity ||
    quotedUnitPriceVnd !== line.unitPriceVnd
  )
    throw new AppError({
      status: 409,
      code: 'CONTRACT_PRINT_SOURCE_CONFLICT',
      message: 'The print allocation conflicts with the approved commercial source.',
    });
  return quantity * line.unitPriceVnd;
}
