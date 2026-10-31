import { z } from 'zod';

export const selectionBlockReasonSchema = z.enum([
  'NOT_CUSTOMER',
  'BOOKING_CLOSED',
  'BOOKING_NOT_EDITABLE',
  'CUSTOMER_SELECTION_SUBMITTED',
  'CONTRACT_DRAFT_EXISTS',
  'CONTRACT_APPROVED',
  'DEPOSIT_SETTLED',
  'DEPOSIT_IN_PROGRESS',
  'PAYMENT_OUTCOME_UNKNOWN',
  'LEGACY_COMMERCIAL_CONVERSION_BLOCKED',
  'FINANCIAL_REVIEW_REQUIRED',
]);
export type SelectionBlockReason = z.infer<typeof selectionBlockReasonSchema>;
export type SelectionFinancialBlockReason = Extract<
  SelectionBlockReason,
  | 'LEGACY_COMMERCIAL_CONVERSION_BLOCKED'
  | 'DEPOSIT_IN_PROGRESS'
  | 'PAYMENT_OUTCOME_UNKNOWN'
  | 'DEPOSIT_SETTLED'
  | 'FINANCIAL_REVIEW_REQUIRED'
>;
export const selectionAccessSchema = z.strictObject({
  canEdit: z.boolean(),
  blockReason: selectionBlockReasonSchema.nullable(),
  nextAction: z.enum([
    'EDIT_SELECTIONS',
    'WAIT_FOR_RESTAURANT',
    'VIEW_CONTRACT',
    'VIEW_PAYMENTS',
    'VIEW_APPENDICES',
    'CONTACT_RESTAURANT',
    'VIEW_BOOKING',
  ]),
});

const actions = {
  NOT_CUSTOMER: 'VIEW_CONTRACT',
  BOOKING_CLOSED: 'VIEW_BOOKING',
  BOOKING_NOT_EDITABLE: 'CONTACT_RESTAURANT',
  CUSTOMER_SELECTION_SUBMITTED: 'WAIT_FOR_RESTAURANT',
  CONTRACT_DRAFT_EXISTS: 'VIEW_CONTRACT',
  CONTRACT_APPROVED: 'VIEW_CONTRACT',
  DEPOSIT_SETTLED: 'VIEW_APPENDICES',
  DEPOSIT_IN_PROGRESS: 'VIEW_PAYMENTS',
  PAYMENT_OUTCOME_UNKNOWN: 'VIEW_PAYMENTS',
  LEGACY_COMMERCIAL_CONVERSION_BLOCKED: 'CONTACT_RESTAURANT',
  FINANCIAL_REVIEW_REQUIRED: 'CONTACT_RESTAURANT',
} as const;

/** The same decision feeds GET capabilities and every selection command. */
export function evaluateSelectionAccess(
  input: Readonly<{
    party: 'MANAGER' | 'COUPLE';
    phase: string;
    commercialModelVersion: 'LEGACY_PROPOSAL_V1' | 'FULL_CONTRACT_V1';
    selectionStatus: string;
    contractState: string | null;
    hasSettlement: boolean;
    depositStatuses: readonly string[];
    financialBlock?: SelectionFinancialBlockReason | null;
  }>,
) {
  let reason: SelectionBlockReason | null;
  if (input.party !== 'COUPLE') reason = 'NOT_CUSTOMER';
  else if (['CANCELLED', 'COMPLETED'].includes(input.phase)) reason = 'BOOKING_CLOSED';
  else if (
    input.hasSettlement ||
    input.phase === 'CONFIRMED' ||
    input.depositStatuses.includes('SETTLED')
  )
    reason = 'DEPOSIT_SETTLED';
  else if (input.depositStatuses.includes('UNKNOWN')) reason = 'PAYMENT_OUTCOME_UNKNOWN';
  else if (input.depositStatuses.includes('ACTIVE')) reason = 'DEPOSIT_IN_PROGRESS';
  else if (input.contractState === 'APPROVED') reason = 'CONTRACT_APPROVED';
  else if (input.contractState !== null) reason = 'CONTRACT_DRAFT_EXISTS';
  else if (input.selectionStatus === 'SUBMITTED') reason = 'CUSTOMER_SELECTION_SUBMITTED';
  else if (input.phase !== 'DRAFT') reason = 'BOOKING_NOT_EDITABLE';
  else reason = input.financialBlock ?? null;
  return selectionAccessSchema.parse({
    canEdit: reason === null,
    blockReason: reason,
    nextAction:
      reason === null
        ? 'EDIT_SELECTIONS'
        : reason === 'DEPOSIT_SETTLED' &&
            (input.phase !== 'CONFIRMED' || input.commercialModelVersion === 'LEGACY_PROPOSAL_V1')
          ? 'VIEW_PAYMENTS'
          : actions[reason],
  });
}
