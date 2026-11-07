import { z } from 'zod';

const money = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const cancellationRefundPolicySchema = z.strictObject({
  version: z.literal('CANCELLATION_REFUND_V1'),
  initiator: z.enum(['COUPLE', 'RESTAURANT']).nullable(),
  requestedAt: z.iso.datetime().nullable(),
  eventStartsAt: z.iso.datetime(),
  contractRevisionId: z.string().nullable(),
  contractTermsVersion: z.string().nullable(),
  depositPaymentId: z.string().nullable(),
  depositReceivedVnd: money,
  ratePercent: z.union([z.literal(0), z.literal(50), z.literal(100)]).nullable(),
  entitledVnd: money.nullable(),
});
export type CancellationRefundPolicy = z.infer<typeof cancellationRefundPolicySchema>;

/** Rules are pinned separately from retained contract/PDF text. No compensation is posted. */
export function cancellationRefundPolicy(input: {
  initiator: 'COUPLE' | 'RESTAURANT' | null;
  requestedAt: Date | null;
  eventStartsAt: Date;
  contractRevisionId: string | null;
  contractTermsVersion: string | null;
  depositPaymentId: string | null;
  depositReceivedVnd: number;
}): CancellationRefundPolicy {
  const hours = input.requestedAt
    ? (input.eventStartsAt.getTime() - input.requestedAt.getTime()) / 3_600_000
    : null;
  const ratePercent =
    input.depositReceivedVnd === 0
      ? 0
      : input.initiator === 'RESTAURANT'
        ? 100
        : input.initiator === 'COUPLE' &&
            input.contractTermsVersion === 'WEDDING_STANDARD_V1' &&
            hours !== null &&
            hours > 0
          ? hours >= 30 * 24
            ? 100
            : hours >= 7 * 24
              ? 50
              : 0
          : null;
  return cancellationRefundPolicySchema.parse({
    ...input,
    version: 'CANCELLATION_REFUND_V1',
    requestedAt: input.requestedAt?.toISOString() ?? null,
    eventStartsAt: input.eventStartsAt.toISOString(),
    ratePercent,
    entitledVnd:
      ratePercent === null
        ? null
        : ratePercent === 100
          ? input.depositReceivedVnd
          : ratePercent === 50
            ? Math.floor(input.depositReceivedVnd / 2)
            : 0,
  });
}
