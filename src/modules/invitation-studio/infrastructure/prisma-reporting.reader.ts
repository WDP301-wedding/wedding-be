import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type {
  InvitationReportingReader,
  SourceQuery,
  SourcePage,
  InvitationReportRow,
  SourceRow,
} from '../application/reporting.contracts.js';
import type { PrintOrderStatus } from '../domain/print-policy.js';

export class PrismaInvitationReportingReader implements InvitationReportingReader {
  constructor(private readonly prisma: PrismaClient) {}

  async readPage(
    query: SourceQuery,
    context: ContractContext,
  ): Promise<SourcePage<InvitationReportRow>> {
    // Only available for authorized Manager/System projection/rebuild
    if (context.authority === 'SYSTEM') {
      const allowedPurposes = ['reporting:invitation-studio', 'reporting:rebuild'];
      if (context.purpose && !allowedPurposes.includes(context.purpose)) {
        return {
          throughSequence: query.throughSequence ?? 0,
          nextCursor: null,
          rows: [],
        };
      }
    } else if (context.authority === 'AUTHENTICATED') {
      if (!context.actorAccountId) {
        return {
          throughSequence: query.throughSequence ?? 0,
          nextCursor: null,
          rows: [],
        };
      }
    } else {
      return {
        throughSequence: query.throughSequence ?? 0,
        nextCursor: null,
        rows: [],
      };
    }

    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const afterSeq = query.afterSequence ?? 0;

    let cursorSeq = afterSeq;
    let cursorId: string | undefined;

    if (query.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString('utf8'),
        ) as { s: number; id: string };
        cursorSeq = decoded.s;
        cursorId = decoded.id;
      } catch {
        // invalid cursor ignored
      }
    }

    // Determine monotonic snapshot fence throughSequence
    let throughSeq = query.throughSequence;
    if (throughSeq === undefined) {
      const latestAudit = await this.prisma.invitationPrintAudit.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      throughSeq = latestAudit ? Number(latestAudit.sequence) : 0;
    }

    const where: Prisma.InvitationPrintAuditWhereInput = {
      sequence: {
        gt: BigInt(cursorSeq),
        lte: BigInt(throughSeq),
      },
    };

    if (cursorId) {
      where.OR = [
        { sequence: { gt: BigInt(cursorSeq) } },
        { sequence: BigInt(cursorSeq), id: { gt: cursorId } },
      ];
    }

    const audits = await this.prisma.invitationPrintAudit.findMany({
      where,
      orderBy: [
        { sequence: 'asc' },
        { id: 'asc' },
      ],
      take: limit + 1,
    });

    const hasNext = audits.length > limit;
    const pagedAudits = hasNext ? audits.slice(0, limit) : audits;

    const orderIds = [...new Set(pagedAudits.map((a) => a.orderId))];
    const orders =
      orderIds.length > 0
        ? await this.prisma.invitationPrintOrder.findMany({
            where: { id: { in: orderIds } },
          })
        : [];
    const orderMap = new Map<string, (typeof orders)[0]>();
    for (const order of orders) {
      orderMap.set(order.id, order);
    }

    const commercialRevisionIds = orders
      .map((o) => o.currentCommercialRevisionId)
      .filter((id): id is string => id !== null);

    const revisions =
      commercialRevisionIds.length > 0
        ? await this.prisma.invitationCommercialRevision.findMany({
            where: { id: { in: commercialRevisionIds } },
            select: { id: true, orderTotalVnd: true },
          })
        : [];

    const revisionAmountMap = new Map<string, number>();
    for (const rev of revisions) {
      revisionAmountMap.set(rev.id, Number(rev.orderTotalVnd));
    }

    const approvalAudits =
      orderIds.length > 0
        ? await this.prisma.invitationPrintAudit.findMany({
            where: {
              orderId: { in: orderIds },
              action: 'invitation.print-order-approved',
            },
            select: { orderId: true, createdAt: true },
          })
        : [];
    const approvalAuditMap = new Map<string, string>();
    for (const a of approvalAudits) {
      approvalAuditMap.set(a.orderId, a.createdAt.toISOString());
    }

    const rows: SourceRow<InvitationReportRow>[] = pagedAudits.map((audit) => {
      const order = orderMap.get(audit.orderId);
      const status = (audit.toStatus ?? order?.status ?? 'REQUESTED') as PrintOrderStatus;
      const isAcceptedStatus =
        status === 'APPROVED' ||
        status === 'IN_PRODUCTION' ||
        status === 'READY_FOR_HANDOVER' ||
        status === 'HANDED_OVER';

      const commercialRevisionId = order?.currentCommercialRevisionId ?? null;
      const acceptedAmountVnd =
        isAcceptedStatus && commercialRevisionId
          ? revisionAmountMap.get(commercialRevisionId) ?? 0
          : 0;

      const approvedAt = isAcceptedStatus
        ? order?.approvedAt?.toISOString() ?? approvalAuditMap.get(audit.orderId) ?? audit.createdAt.toISOString()
        : null;

      const value: InvitationReportRow = {
        bookingId: audit.bookingId,
        printOrderId: audit.orderId,
        status,
        commercialRevisionId,
        receivableChargeId: order?.receivableChargeId ?? null,
        acceptedAmountVnd,
        approvedAt,
        updatedAt: order ? order.updatedAt.toISOString() : audit.createdAt.toISOString(),
      };

      return {
        recordId: audit.orderId,
        sequence: Number(audit.sequence),
        changedAt: audit.createdAt.toISOString(),
        value,
      };
    });

    let nextCursor: string | null = null;
    const last = pagedAudits[pagedAudits.length - 1];
    if (hasNext && last) {
      nextCursor = Buffer.from(
        JSON.stringify({ s: Number(last.sequence), id: last.id }),
      ).toString('base64url');
    }

    return {
      throughSequence: throughSeq,
      nextCursor,
      rows,
    };
  }
}
