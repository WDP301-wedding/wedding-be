import type { ContractContext } from './payments-billing.providers.js';
import type { PaymentAttempt } from './billing-ledger.port.js';

export class VnpayProtocolError extends Error {
  constructor(readonly reason: 'SIGNATURE' | 'FIELDS' | 'CORRELATION') {
    super('VNPay evidence could not be verified.');
  }
}

export type VnpaySettings = Readonly<{
  merchantCode: string;
  hashSecret: string;
  returnUrl: string;
  queryIp: string;
}>;
export type ProviderEvidence = Readonly<{
  paymentAttemptId: string;
  merchantCode: string;
  transactionId: string;
  amountVnd: number;
  outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  settledAt: string | null;
  payloadHash: string;
  channel: 'IPN' | 'QUERY';
  correlationConflict?: 'CURRENCY' | undefined;
  nonPaymentReason?: 'NOT_FOUND' | 'UNPAID' | undefined;
  resolutionReason?: 'EXPIRED_UNPAID' | undefined;
  sourcePayloadHash?: string | undefined;
}>;
export type StoredProviderEvidence = ProviderEvidence &
  Readonly<{ id: string; decision: 'ACCEPTED' | 'CONFLICT' | 'AMOUNT_MISMATCH' }>;
export type CheckoutSnapshot = Readonly<{
  paymentAttemptId: string;
  parameters: Readonly<Record<string, string>>;
}>;

export interface VnpayEvidenceRepository {
  findAttemptBooking(paymentAttemptId: string): Promise<string | null>;
  saveCheckout(
    bookingId: string,
    input: CheckoutSnapshot,
    context: ContractContext,
  ): Promise<CheckoutSnapshot>;
  getCheckout(
    bookingId: string,
    paymentAttemptId: string,
    context: ContractContext,
  ): Promise<CheckoutSnapshot | null>;
  recordEvidence(
    bookingId: string,
    input: ProviderEvidence,
    context: ContractContext,
  ): Promise<Readonly<{ evidence: StoredProviderEvidence; replayed: boolean }>>;
  getTerminalEvidence(
    bookingId: string,
    paymentAttemptId: string,
    context: ContractContext,
  ): Promise<StoredProviderEvidence | null>;
}

export interface VnpayStatusGateway {
  query(request: Readonly<Record<string, string>>): Promise<unknown>;
}

export interface VnpayProtocol {
  createCheckout(
    attempt: PaymentAttempt,
    ip: string,
  ): Readonly<{ parameters: Readonly<Record<string, string>>; url: string }>;
  checkoutUrl(parameters: Readonly<Record<string, string>>): string;
  verifyIpn(rawQuery: string): ProviderEvidence;
  verifyQuery(raw: unknown, attempt?: Pick<PaymentAttempt, 'id' | 'amountVnd'>): ProviderEvidence;
  createQuery(
    input: Readonly<{
      paymentAttemptId: string;
      transactionDate: string;
      requestId: string;
      createdAt: string;
    }>,
  ): Readonly<Record<string, string>>;
}
