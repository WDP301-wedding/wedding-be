import { enlistedPrismaClient } from '../../../core/database/enlisted-prisma-client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { createContractFinancialReader } from '../../booking-lifecycle/infrastructure/contract-financial.reader.js';
import { createEffectiveCommercialReader } from '../../booking-lifecycle/infrastructure/effective-commercial.reader.js';
import { createPrismaBillingPersistence } from '../../payments-billing/infrastructure/billing.persistence.js';
import { createPrintOfferingReader } from '../../venue-catalog/application/print-offering.service.js';
import { createInvitationTemplateSelectionReader } from './template-selection.reader.js';
import { ContractedPrintFulfillment } from './contracted-print.fulfillment.js';

export function createContractedPrintFulfillment() {
  return new ContractedPrintFulfillment({
    commercial: createEffectiveCommercialReader,
    model: (client, bookingId) => createContractFinancialReader(client).getModel(bookingId),
    offerings: (client) =>
      createPrintOfferingReader(
        enlistedPrismaClient(client),
        createInvitationTemplateSelectionReader,
      ),
    async contractObligation(client, bookingId) {
      const snapshot = await createPrismaBillingPersistence(
        enlistedPrismaClient(client),
      ).repository.getLedger(bookingId);
      const charge = snapshot.entries.find((e) => e.sourceType === 'CONTRACT');
      if (!charge) throw new NotFoundError();
      return charge.id;
    },
  });
}
