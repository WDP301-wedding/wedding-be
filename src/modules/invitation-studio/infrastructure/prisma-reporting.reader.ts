import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type {
  InvitationReportingReader,
  SourceQuery,
  SourcePage,
  InvitationReportRow,
  SourceRow,
} from '../application/reporting.contracts.js';
import { z } from 'zod';
import { ValidationError } from '../../../core/errors/app-error.js';
const reportSnapshot = z.strictObject({
  bookingId: z.uuid(),
  printOrderId: z.uuid(),
  status: z.enum([
    'REQUESTED',
    'QUOTED',
    'APPROVED',
    'IN_PRODUCTION',
    'READY_FOR_HANDOVER',
    'HANDED_OVER',
    'CANCELLED',
  ]),
  commercialRevisionId: z.uuid().nullable(),
  receivableChargeId: z.uuid().nullable(),
  acceptedAmountVnd: z.number().int().nonnegative().max(1_000_000_000_000),
  approvedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

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
        const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
          s: number;
          id: string;
        };
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
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });

    const hasNext = audits.length > limit;
    const pagedAudits = hasNext ? audits.slice(0, limit) : audits;

    const rows: SourceRow<InvitationReportRow>[] = pagedAudits.map((audit) => {
      const snapshot = reportSnapshot.safeParse(audit.reportingSnapshot);
      if (
        !snapshot.success ||
        snapshot.data.bookingId !== audit.bookingId ||
        snapshot.data.printOrderId !== audit.orderId ||
        snapshot.data.status !== audit.toStatus
      )
        throw new ValidationError();
      const value: InvitationReportRow = snapshot.data;

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
      nextCursor = Buffer.from(JSON.stringify({ s: Number(last.sequence), id: last.id })).toString(
        'base64url',
      );
    }

    return {
      throughSequence: throughSeq,
      nextCursor,
      rows,
    };
  }
}
