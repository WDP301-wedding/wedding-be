import { z } from 'zod';
import type { ContractContext } from './payments-billing.providers.js';

const money = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// Current commercial information, never a ledger entry or a payment authorization.
export const billingFinancialOverviewSchema = z.strictObject({
  bookingRevision: z.int().positive(),
  phase: z.enum(['DRAFT', 'AWAITING_DEPOSIT', 'CONFIRMED', 'COMPLETED', 'CANCELLED']),
  source: z.enum(['CONTRACT', 'LEGACY_PROPOSAL', 'NONE']),
  state: z.enum(['NOT_CREATED', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED']),
  revisionId: z.uuid().nullable(),
  revisionNumber: z.int().positive().nullable(),
  totalVnd: money.nullable(),
  requiredDepositVnd: money.nullable(),
  depositReceivedVnd: money,
  depositRemainingVnd: money.nullable(),
  depositApplied: z.boolean(),
  settlementSummary: z
    .strictObject({
      effectiveContractVnd: money.nullable(),
      payableVnd: money.nullable(),
      netReceivedVnd: money,
      outstandingVnd: money.nullable(),
      creditVnd: money,
    })
    .optional(),
});

export type BillingFinancialOverview = z.infer<typeof billingFinancialOverviewSchema>;
export type BillingFinancialOverviewReader = (
  bookingId: string,
  context: ContractContext,
) => Promise<BillingFinancialOverview>;
