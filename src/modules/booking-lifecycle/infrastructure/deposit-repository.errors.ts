import { AppError } from '../../../core/errors/app-error.js';

export type DepositConflictCode =
  | 'TIMELINE_NOT_MUTUALLY_APPROVED'
  | 'REVISION_SUPERSEDED'
  | 'SLOT_NOT_AVAILABLE'
  | 'BOOKING_NOT_PAYABLE'
  | 'CONTRACT_APPROVAL_REQUIRED'
  | 'STALE_BOOKING_REVISION'
  | 'DEPOSIT_INTENT_ACTIVE'
  | 'PAYMENT_EVIDENCE_CONFLICT';

const depositMessages: Readonly<Record<DepositConflictCode, string>> = {
  TIMELINE_NOT_MUTUALLY_APPROVED: 'The current timeline is not mutually approved.',
  REVISION_SUPERSEDED: 'The requested timeline revision is no longer current.',
  SLOT_NOT_AVAILABLE: 'The booking slot is not available.',
  BOOKING_NOT_PAYABLE: 'The booking cannot accept a deposit.',
  CONTRACT_APPROVAL_REQUIRED: 'The current commercial contract is not mutually approved.',
  STALE_BOOKING_REVISION: 'The booking changed after it was loaded.',
  DEPOSIT_INTENT_ACTIVE: 'An unresolved deposit attempt already pins this booking.',
  PAYMENT_EVIDENCE_CONFLICT: 'The payment evidence conflicts with an existing settlement.',
};

export class BookingDepositConflictError extends AppError {
  constructor(code: DepositConflictCode) {
    super({
      status: 409,
      code,
      message: depositMessages[code],
    });
  }
}
