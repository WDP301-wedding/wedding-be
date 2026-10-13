import type { CoupleAccessPromoter } from '../../identity-access/authorization/couple-access-promotion.js';
import type { DepositEligibilityReason } from '../domain/deposit.policy.js';

export type ContractContext = Readonly<{
  requestId: string;
  causationId: string;
  actorAccountId: string | null;
  authority: 'AUTHENTICATED' | 'SYSTEM';
  transactionScopeId?: string;
  purpose?: string;
}>;

export type DepositEligibility = Readonly<{
  eligible: boolean;
  reasonCode: DepositEligibilityReason;
  consultationId: string;
  coupleAccountId: string;
  bookingRevision: number;
  depositAmountVnd: number;
  contractRevisionId?: string | null;
  documentDigest?: string | null;
  contractTotalVnd?: number;
}>;

export type ReserveDepositInput = Readonly<{
  bookingId: string;
  timelineRevisionId: string;
  contractRevisionId?: string | null;
  documentDigest?: string | null;
  paymentAttemptId: string;
  expectedBookingRevision: number;
  amountVnd: number;
  expiresAt: string;
  // Internal manual-payment callers request Booking's intended Couple; the
  // repository still verifies the authenticated Manager and audits that actor.
  reserveForIntendedCouple?: true;
}>;

export type RecordSuccessfulDepositInput = Readonly<{
  bookingId: string;
  timelineRevisionId: string;
  contractRevisionId?: string | null;
  documentDigest?: string | null;
  paymentId: string;
  amountVnd: number;
  settledAt: Date;
}>;

type SettlementResult = Readonly<{
  phase: 'CONFIRMED';
  replayed: boolean;
  promotionPending: boolean;
  accountId: string;
  consultationId: string;
  requestId: string;
}>;

export interface BookingDepositRepository {
  requireDepositEligibility(
    input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
  ): Promise<DepositEligibility>;
  reserve(
    input: ReserveDepositInput &
      Readonly<{ requestId: string; actorAccountId: string | null; causationId?: string }>,
  ): Promise<Readonly<{ paymentAttemptId: string; bookingRevision: number; replayed: boolean }>>;
  recordUnknown(
    input: Readonly<{ bookingId: string; paymentAttemptId: string; requestId: string }>,
  ): Promise<void>;
  releaseVerifiedFailure(
    input: Readonly<{
      bookingId: string;
      paymentAttemptId: string;
      providerEvidenceId: string;
      requestId: string;
    }>,
  ): Promise<void>;
  settle(input: RecordSuccessfulDepositInput): Promise<SettlementResult>;
  markPromotionSucceeded(paymentId: string, promotedAt: Date): Promise<void>;
}

export interface BookingDepositIntentCoordinator {
  reserve(
    input: ReserveDepositInput,
    context: ContractContext,
  ): Promise<Readonly<{ paymentAttemptId: string; bookingRevision: number; replayed: boolean }>>;
  recordUnknown(
    input: Readonly<{ bookingId: string; paymentAttemptId: string }>,
    context: ContractContext,
  ): Promise<void>;
  releaseVerifiedFailure(
    input: Readonly<{ bookingId: string; paymentAttemptId: string; providerEvidenceId: string }>,
    context: ContractContext,
  ): Promise<void>;
}

export interface BookingDepositRecorder {
  recordSuccessfulDeposit(
    input: RecordSuccessfulDepositInput,
  ): Promise<Readonly<{ phase: 'CONFIRMED'; replayed: boolean }>>;
}

export function createBookingDepositService(
  options: Readonly<{
    repository: BookingDepositRepository;
    promoter: CoupleAccessPromoter;
  }>,
): BookingDepositIntentCoordinator &
  BookingDepositRecorder &
  Readonly<{
    requireDepositEligibility: BookingDepositRepository['requireDepositEligibility'];
  }> {
  return Object.freeze({
    requireDepositEligibility(input: Readonly<{ bookingId: string; timelineRevisionId: string }>) {
      return options.repository.requireDepositEligibility(input);
    },

    reserve(input: ReserveDepositInput, context: ContractContext) {
      return options.repository.reserve({
        ...input,
        requestId: context.requestId,
        causationId: context.causationId,
        actorAccountId: context.actorAccountId,
      });
    },

    recordUnknown(
      input: Readonly<{ bookingId: string; paymentAttemptId: string }>,
      context: ContractContext,
    ) {
      return options.repository.recordUnknown({ ...input, requestId: context.requestId });
    },

    releaseVerifiedFailure(
      input: Readonly<{ bookingId: string; paymentAttemptId: string; providerEvidenceId: string }>,
      context: ContractContext,
    ) {
      return options.repository.releaseVerifiedFailure({ ...input, requestId: context.requestId });
    },

    async recordSuccessfulDeposit(input: RecordSuccessfulDepositInput) {
      const settlement = await options.repository.settle(input);
      if (settlement.promotionPending) {
        await options.promoter.promote({
          accountId: settlement.accountId,
          consultationId: settlement.consultationId,
          sourcePaymentId: input.paymentId,
          requestId: settlement.requestId,
        });
        await options.repository.markPromotionSucceeded(input.paymentId, input.settledAt);
      }
      return Object.freeze({ phase: 'CONFIRMED' as const, replayed: settlement.replayed });
    },
  });
}
