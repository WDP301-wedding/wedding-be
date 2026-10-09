import type { ContractContext } from '../../../core/database/booking-boundary.js';

export interface BillingReader {
  getBookingReceivables(bookingId: string): Promise<{
    acceptedChargesVnd: number;
    paidVnd: number;
    refundedVnd: number;
    outstandingVnd: number;
  }>;
}

export interface BookingChargeRegistrar {
  registerAcceptedCharge(input: {
    bookingId: string;
    sourceType: 'PRINT_ORDER';
    sourceRevisionId: string;
    amountVnd: number;
    acceptedAt: Date;
  }): Promise<{ receivableChargeId: string; replayed: boolean }>;
}

export interface BookingChargeAdjustmentRegistrar {
  registerCredit(
    input: Readonly<{
      bookingId: string;
      receivableChargeId: string;
      sourceAdjustmentId: string;
      amountVnd: number;
      reason: 'PRINT_CANCELLED' | 'PRINT_REPLACED';
      acceptedAt: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      adjustmentId: string;
      replayed: boolean;
    }>
  >;
}
