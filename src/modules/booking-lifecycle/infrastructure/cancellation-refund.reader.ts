import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { localVietnamTime } from '../domain/lifecycle.policy.js';
import {
  cancellationRefundPolicy,
  cancellationRefundPolicySchema,
} from '../domain/cancellation-refund-policy.js';

/** Booking-owned evidence shared with Billing inside its existing booking transaction. */
export async function readCancellationRefundPolicy(
  tx: Prisma.TransactionClient,
  bookingId: string,
  input?: {
    initiator: 'COUPLE' | 'RESTAURANT' | null;
    requestedAt: Date | null;
    fallbackRequestedAt?: Date;
  },
) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      phase: true,
      eventDate: true,
      cancelledAt: true,
      cancellationRefundPolicy: true,
      proposalSnapshot: { select: { shiftStartTime: true } },
      depositSettlement: { select: { paymentId: true, amountVnd: true, contractRevisionId: true } },
      cancellationRequests: {
        where: { status: 'PENDING' },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { requestedAt: true },
      },
    },
  });
  if (!input && booking.cancellationRefundPolicy)
    return cancellationRefundPolicySchema.parse(booking.cancellationRefundPolicy);
  const deposit = booking.depositSettlement;
  const contract = deposit?.contractRevisionId
    ? await tx.commercialContractRevision.findUnique({
        where: { id: deposit.contractRevisionId },
        select: { document: true },
      })
    : null;
  const terms = z
    .object({ standardTerms: z.object({ version: z.string() }).optional() })
    .safeParse(contract?.document);
  const start = booking.proposalSnapshot?.shiftStartTime;
  if (!start) throw new Error('Missing agreed event start');
  return cancellationRefundPolicy({
    initiator: input ? input.initiator : booking.phase === 'CANCELLED' ? null : 'COUPLE',
    requestedAt: input
      ? (input.requestedAt ??
        (input.initiator === 'COUPLE'
          ? (booking.cancellationRequests[0]?.requestedAt ?? input.fallbackRequestedAt ?? null)
          : null))
      : booking.phase === 'CANCELLED'
        ? null
        : (booking.cancellationRequests[0]?.requestedAt ?? null),
    eventStartsAt: localVietnamTime(
      booking.eventDate.toISOString().slice(0, 10),
      start.toISOString().slice(11, 16),
    ),
    contractRevisionId: deposit?.contractRevisionId ?? null,
    contractTermsVersion: terms.success ? (terms.data.standardTerms?.version ?? null) : null,
    depositPaymentId: deposit?.paymentId ?? null,
    depositReceivedVnd: Number(deposit?.amountVnd ?? 0),
  });
}
