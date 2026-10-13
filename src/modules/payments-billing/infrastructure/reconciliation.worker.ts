import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { createVnpayService } from '../application/vnpay.service.js';
/** Read-only provider status queries plus the existing verified, once-only
 * settlement/application port. Never initiates checkout, charge or refund. */
export function createBillingReconciliationWorker(
  prisma: PrismaClient,
  vnpay: ReturnType<typeof createVnpayService>,
  now: () => Date = () => new Date(),
) {
  return {
    async run(bookingIds?: readonly string[]) {
      const at = now(),
        scope =
          bookingIds === undefined
            ? Prisma.empty
            : bookingIds.length === 0
              ? Prisma.sql`AND false`
              : Prisma.sql`AND a."bookingId" IN (${Prisma.join(bookingIds.map((id) => Prisma.sql`${id}::uuid`))})`;
      const candidates = await prisma.$queryRaw<{ id: string; bookingId: string }[]>(Prisma.sql`
   SELECT a.id,a."bookingId" FROM "BillingPaymentAttempt" a
   JOIN "BillingVnpayCheckout" c ON c."paymentAttemptId"=a.id
   LEFT JOIN "BillingLedgerEntry" p ON p."paymentAttemptId"=a.id AND p.kind='PAYMENT'
   LEFT JOIN "BillingDepositApplication" d ON d."paymentId"=p.id
   LEFT JOIN "BillingReconciliationLease" l ON l."paymentAttemptId"=a.id
   WHERE a.provider='VNPAY' AND (a.state IN ('PENDING','UNKNOWN') OR (a.state='SUCCEEDED' AND a.purpose='DEPOSIT' AND d."paymentId" IS NULL))
   AND (l."paymentAttemptId" IS NULL OR (l."leaseUntil"<=${at} AND l."nextAttemptAt"<=${at})) ${scope}
   ORDER BY a."updatedAt",a.id LIMIT 100`);
      let attempted = 0,
        failed = 0;
      for (const row of candidates) {
        const lease =
          await prisma.$executeRaw`INSERT INTO "BillingReconciliationLease" ("paymentAttemptId","leaseUntil","nextAttemptAt") VALUES (${row.id}::uuid,${new Date(at.getTime() + 120000)},${new Date(at.getTime() + 300000)}) ON CONFLICT ("paymentAttemptId") DO UPDATE SET "leaseUntil"=EXCLUDED."leaseUntil","nextAttemptAt"=EXCLUDED."nextAttemptAt" WHERE "BillingReconciliationLease"."leaseUntil"<=${at} AND "BillingReconciliationLease"."nextAttemptAt"<=${at}`;
        if (lease !== 1) continue;
        attempted++;
        try {
          const requestId = randomUUID();
          await vnpay.reconcile(row.bookingId, row.id, {
            requestId,
            causationId: requestId,
            actorAccountId: null,
            authority: 'SYSTEM',
          });
        } catch {
          failed++;
        }
      }
      return { attempted, failed };
    },
  };
}
