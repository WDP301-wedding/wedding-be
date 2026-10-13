import type { PrismaClient } from '../../../generated/prisma/client.js';
export function createNotificationCutoffReader(prisma: PrismaClient) {
  return {
    async read(bookingId: string) {
      const row = await prisma.invitationMediaPolicy.findUnique({ where: { bookingId } });
      return row === null ? null : { revision: row.revision, cutoffAt: row.cutoffAt };
    },
  };
}
