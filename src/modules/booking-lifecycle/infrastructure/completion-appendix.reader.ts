import type { Prisma } from '../../../generated/prisma/client.js';
import { completionAppendix } from '../domain/completion-appendix.js';

export async function readCompletionAppendix(client: Prisma.TransactionClient, bookingId: string) {
  const head = await client.commercialAppendixHead.findUnique({
    where: { bookingId },
    include: { currentRevision: { include: { approvals: true } } },
  });
  return completionAppendix(head?.currentRevision);
}
