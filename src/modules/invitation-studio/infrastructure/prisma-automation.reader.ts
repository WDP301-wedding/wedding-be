import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type {
  InvitationAutomationReader,
  ListMediaCutoffsInput,
  ListMediaCutoffsResult,
  MediaCutoffItem,
} from '../application/automation.contracts.js';

export class PrismaInvitationAutomationReader implements InvitationAutomationReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listMediaCutoffs(
    input: ListMediaCutoffsInput,
    context: ContractContext,
  ): Promise<ListMediaCutoffsResult> {
    if (context.authority === 'SYSTEM') {
      const allowedPurposes = ['automation:media-cutoff', 'notifications:media-cutoff'];
      if (context.purpose && !allowedPurposes.includes(context.purpose)) {
        return { nextCursor: null, items: [] };
      }
    } else if (context.authority === 'AUTHENTICATED') {
      if (!context.actorAccountId) {
        return { nextCursor: null, items: [] };
      }
    } else {
      return { nextCursor: null, items: [] };
    }

    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const dueBefore = new Date(input.dueBefore);

    let cursorCutoffAt: Date | undefined;
    let cursorBookingId: string | undefined;

    if (input.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as {
          c: string;
          b: string;
        };
        cursorCutoffAt = new Date(decoded.c);
        cursorBookingId = decoded.b;
      } catch {
        // invalid cursor ignored
      }
    }

    const where: Prisma.InvitationMediaPolicyWhereInput = {
      cutoffAt: {
        lte: dueBefore,
      },
    };

    if (cursorCutoffAt && cursorBookingId) {
      where.OR = [
        { cutoffAt: { gt: cursorCutoffAt } },
        { cutoffAt: cursorCutoffAt, bookingId: { gt: cursorBookingId } },
      ];
    }

    const policies = await this.prisma.invitationMediaPolicy.findMany({
      where,
      orderBy: [{ cutoffAt: 'asc' }, { bookingId: 'asc' }],
      take: limit + 1,
    });

    const hasNext = policies.length > limit;
    const pagedPolicies = hasNext ? policies.slice(0, limit) : policies;

    const bookingIds = pagedPolicies.map((p) => p.bookingId);

    const eligibleBookings =
      bookingIds.length > 0
        ? await this.prisma.booking.findMany({
            where: {
              id: { in: bookingIds },
              phase: 'CONFIRMED',
              depositSettlement: { isNot: null },
            },
            select: { id: true },
          })
        : [];
    const eligibleBookingSet = new Set(eligibleBookings.map((b) => b.id));

    const accesses =
      bookingIds.length > 0
        ? await this.prisma.consultationAccess.findMany({
            where: {
              bookingId: { in: bookingIds },
              level: 'FULL',
            },
            select: {
              bookingId: true,
              accountId: true,
            },
          })
        : [];

    const coupleAccountMap = new Map<string, string>();
    for (const acc of accesses) {
      if (acc.bookingId) {
        coupleAccountMap.set(acc.bookingId, acc.accountId);
      }
    }

    // Only include items with valid Couple account and confirmed eligible booking; never zero-UUID
    const items: MediaCutoffItem[] = [];
    for (const p of pagedPolicies) {
      const coupleAccountId = coupleAccountMap.get(p.bookingId);
      if (coupleAccountId && eligibleBookingSet.has(p.bookingId)) {
        items.push({
          bookingId: p.bookingId,
          cutoffAt: p.cutoffAt.toISOString(),
          policyRevision: p.revision,
          coupleAccountId,
        });
      }
    }

    let nextCursor: string | null = null;
    const last = pagedPolicies[pagedPolicies.length - 1];
    if (hasNext && last) {
      nextCursor = Buffer.from(
        JSON.stringify({ c: last.cutoffAt.toISOString(), b: last.bookingId }),
      ).toString('base64url');
    }

    return {
      nextCursor,
      items,
    };
  }
}
