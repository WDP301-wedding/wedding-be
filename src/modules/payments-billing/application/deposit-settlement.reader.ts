/** Baseline6.4 read subset. Only a trusted Payments acceptance path may append the
 * persisted verified settlement; this adapter cannot manufacture/settle payments. */
export interface DepositSettlementReader {
  requireDepositSettlement(bookingId: string): Promise<{
    paymentId: string;
    amountVnd: number;
    settledAt: Date;
  }>;
}
