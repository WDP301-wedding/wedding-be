import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import type { ContractContext } from '../application/payments-billing.providers.js';
import { createContractFinancialReader } from '../../booking-lifecycle/infrastructure/contract-financial.reader.js';
import { commercialConflict } from '../../booking-lifecycle/domain/commercial-contract.js';
import { finalInvoiceView } from '../application/final-invoice.service.js';

export type InvoiceBalancePin = Readonly<{
  invoiceRevisionId: string;
  invoiceDigest: string;
  totalVnd: number;
}>;
export function createInvoiceBalanceReader(
  prisma: PrismaClient,
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>,
) {
  return Object.freeze({
    getApplicable(bookingId: string, context: ContractContext): Promise<InvoiceBalancePin | null> {
      return scope.withClient(bookingId, context, async (client) => {
        if (
          (await createContractFinancialReader(client).getModel(bookingId)) === 'LEGACY_PROPOSAL_V1'
        )
          return null;
        const head = await client.finalInvoiceHead.findUnique({
          where: { bookingId },
          include: { currentRevision: true },
        });
        if (!head?.currentRevision) throw commercialConflict('INVOICE_FINALIZATION_REQUIRED');
        const view = finalInvoiceView(head.currentRevision);
        return Object.freeze({
          invoiceRevisionId: view.invoiceRevisionId,
          invoiceDigest: view.documentDigest,
          totalVnd: view.document.totalVnd,
        });
      });
    },
  });
}
