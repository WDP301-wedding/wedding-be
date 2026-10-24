import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { prismaSchema } from '../database/prisma.js';

export interface DeliveryClaim {
  readonly eventId: string;
  readonly revision: number;
  readonly leaseToken: string;
}

/** PostgreSQL is the authority for delivery ownership, including Redis outages. */
export function createDeliveryQueue(prisma: PrismaClient) {
  const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
  return {
    claim(stream: string): Promise<DeliveryClaim[]> {
      const token = randomUUID();
      return prisma.$queryRaw<DeliveryClaim[]>(Prisma.sql`
        WITH pending AS (
          SELECT "stream", "eventId", "revision" FROM ${schema}."RealtimeDelivery"
          WHERE "stream"=${stream} AND "deliveredAt" IS NULL
            AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp())
          ORDER BY "enqueuedAt", "eventId", "revision"
          LIMIT 50 FOR UPDATE SKIP LOCKED
        )
        UPDATE ${schema}."RealtimeDelivery" d
        SET "leaseToken"=${token}::uuid, "leaseUntil"=clock_timestamp()+interval '60 seconds'
        FROM pending p WHERE d."stream"=p."stream" AND d."eventId"=p."eventId" AND d."revision"=p."revision"
        RETURNING d."eventId", d."revision", d."leaseToken"
      `);
    },
    async renew(stream: string, claim: DeliveryClaim): Promise<boolean> {
      const count = await prisma.$executeRaw(Prisma.sql`
        UPDATE ${schema}."RealtimeDelivery" SET "leaseUntil"=clock_timestamp()+interval '60 seconds'
        WHERE "stream"=${stream} AND "eventId"=${claim.eventId}::uuid AND "revision"=${claim.revision}
          AND "leaseToken"=${claim.leaseToken}::uuid AND "leaseUntil">clock_timestamp() AND "deliveredAt" IS NULL
      `);
      return count === 1;
    },
    async finish(stream: string, claim: DeliveryClaim, delivered: boolean): Promise<void> {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE ${schema}."RealtimeDelivery"
        SET "deliveredAt"=CASE WHEN ${delivered} THEN clock_timestamp() ELSE NULL END,
            "leaseToken"=NULL,
            "leaseUntil"=CASE WHEN ${delivered} THEN NULL ELSE clock_timestamp()+interval '30 seconds' END
        WHERE "stream"=${stream} AND "eventId"=${claim.eventId}::uuid AND "revision"=${claim.revision}
          AND "leaseToken"=${claim.leaseToken}::uuid
          AND (NOT ${delivered} OR "leaseUntil">clock_timestamp())
      `);
    },
  };
}
