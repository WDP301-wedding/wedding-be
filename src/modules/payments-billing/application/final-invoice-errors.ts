import { Prisma } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { commercialConflict } from '../../booking-lifecycle/domain/commercial-contract.js';

// Translate only known persistence failures. Unknown faults remain server errors;
// never accept an invoice or suppress a financial guard after a database failure.
export function rethrowInvoiceFailure(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') throw commercialConflict('STALE_BILLING_REVISION');
    if (error.code === 'P2021' || error.code === 'P2022')
      throw new AppError({
        status: 503,
        code: 'INVOICE_STORAGE_NOT_READY',
        message: 'Invoice storage requires the current database migrations.',
      });
    if (error.code === 'P2004' || error.code === 'P2010') {
      const detail = JSON.stringify(error.meta ?? {});
      const known = [
        ['commercial invoice requires eligible booking', 'INVOICE_NOT_ELIGIBLE'],
        ['commercial invoice requires authoritative event end', 'EVENT_NOT_ENDED'],
        ['unresolved payment pins monetary revisions', 'PAYMENT_ATTEMPT_ACTIVE'],
        ['invoice predecessor is stale', 'INVOICE_REVISION_STALE'],
        ['final invoice source snapshot conflicts', 'FINANCIAL_SOURCE_CONFLICT'],
        ['invoice original contract conflicts', 'FINANCIAL_SOURCE_CONFLICT'],
        ['invoice activation and ledger must commit together', 'FINANCIAL_SOURCE_CONFLICT'],
      ] as const;
      for (const [message, code] of known)
        if (detail.includes(message)) throw commercialConflict(code);
    }
  }
  throw error;
}
