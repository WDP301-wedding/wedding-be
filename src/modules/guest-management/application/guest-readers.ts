import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { GuestService } from './guest.service.js';
import { guestDto } from './guest.service.js';
import type {
  GuestDeliveryPreparation,
  GuestDeliveryRecipient,
  GuestRequestContext,
} from './guest.contracts.js';
import { conflict, digest, id, normalizeGroupName, parse } from '../domain/guest-policy.js';

export const listQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().max(1024).optional(),
  guestGroupId: id.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
});
export const searchQuerySchema = z.strictObject({
  query: z.string().trim().normalize('NFKC').min(2).max(120),
  limit: z.int().min(1).max(50).default(25),
  cursor: z.string().max(1024).optional(),
});
const cursorSchema = z.strictObject({
  id,
  sequence: z.int().nonnegative(),
  filterDigest: z.string().length(64),
  rank: z.int().min(0).max(2).optional(),
});
function cursor(value: string | undefined, sequence: number, filter: unknown) {
  if (value === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError();
  }
  const decoded = parse(cursorSchema, raw);
  if (decoded.sequence !== sequence || decoded.filterDigest !== digest(filter))
    throw conflict('GUEST_LIST_CURSOR_STALE');
  return decoded;
}
const encode = (value: z.infer<typeof cursorSchema>) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
export const reportSchema = z.strictObject({
  bookingId: z.uuid(),
  planningHeadcount: z.int().min(0).max(10000),
  sourceGuestPlanRevisionId: z.uuid(),
  planSourceSequence: z.int().nonnegative(),
  listedGuestCount: z.int().min(0).max(10000),
  groups: z.array(
    z.strictObject({
      guestGroupId: z.uuid(),
      bookingId: z.uuid(),
      name: z.string().min(1).max(80),
      color: z.string().regex(/^#[A-F0-9]{6}$/u),
      status: z.enum(['ACTIVE', 'ARCHIVED']),
      revision: z.int().positive(),
      listedGuestCount: z.int().nonnegative(),
    }),
  ),
});
export type GuestStaffAccessFacade = Readonly<{
  requireAssignedOperationsAccess(bookingId: string, context: GuestRequestContext): Promise<void>;
}>;

/** No raw search reader grants Staff access: a mode/assignment/window-aware Staff
 * owner facade must be supplied before Staff can consume operations. */
export class GuestReaders {
  constructor(
    readonly guests: GuestService,
    readonly staff?: GuestStaffAccessFacade,
  ) {}
  private async operations<T>(
    bookingId: string,
    context: GuestRequestContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const tx = this.guests.repository.boundary.current(bookingId);
    if (tx !== undefined) {
      if (
        this.guests.repository.boundary.currentContext(bookingId)?.actorAccountId !==
        context.actorId
      )
        throw new NotFoundError();
      await this.authorizeOperations(bookingId, context);
      return work(tx);
    }
    return this.guests.repository.run(
      bookingId,
      context,
      () => this.authorizeOperations(bookingId, context),
      work,
    );
  }
  async list(bookingId: string, value: unknown, context: GuestRequestContext) {
    const input = parse(listQuerySchema, value);
    return this.guests.read(bookingId, context, async (tx, _scope, workspace) => {
      const filter = { bookingId, guestGroupId: input.guestGroupId ?? null, status: input.status };
      const after = cursor(input.cursor, workspace.listSequence, filter);
      const rows = await tx.guest.findMany({
        where: {
          bookingId,
          status: input.status,
          ...(input.guestGroupId === undefined ? {} : { guestGroupId: input.guestGroupId }),
          ...(after === null ? {} : { id: { gt: after.id } }),
        },
        orderBy: { id: 'asc' },
        take: input.limit + 1,
      });
      return {
        items: rows.slice(0, input.limit).map(guestDto),
        sourceSequence: workspace.listSequence,
        nextCursor:
          rows.length > input.limit
            ? encode({
                id: rows[input.limit - 1]!.id,
                sequence: workspace.listSequence,
                filterDigest: digest(filter),
              })
            : null,
      };
    });
  }
  async getPlan(bookingValue: string) {
    const bookingId = parse(id, bookingValue);
    const tx = this.guests.repository.boundary.current(bookingId) ?? this.guests.repository.prisma;
    const workspace = await tx.guestWorkspace.findUnique({ where: { bookingId } });
    if (workspace === null) throw new NotFoundError();
    const row = await tx.guestPlanRevision.findUniqueOrThrow({
      where: { id: workspace.planRevisionId },
    });
    return {
      sourceGuestPlanRevisionId: row.id,
      sourceSequence: row.sourceSequence,
      expectedAttendees: row.planningHeadcount,
    };
  }
  async getActiveGuestCount(bookingValue: string) {
    const bookingId = parse(id, bookingValue);
    return (
      this.guests.repository.boundary.current(bookingId) ?? this.guests.repository.prisma
    ).guest.count({ where: { bookingId, status: 'ACTIVE' } });
  }
  async getGuestReference(guestValue: string) {
    const guestId = parse(id, guestValue);
    const row = await (
      this.guests.repository.boundary.current() ?? this.guests.repository.prisma
    ).guest.findUnique({ where: { id: guestId }, select: { id: true, bookingId: true } });
    if (!row) throw new NotFoundError();
    this.guests.repository.boundary.current(row.bookingId);
    return { guestId: row.id, bookingId: row.bookingId };
  }
  async listGuestGroups(bookingValue: string) {
    const bookingId = parse(id, bookingValue);
    return (
      await (
        this.guests.repository.boundary.current(bookingId) ?? this.guests.repository.prisma
      ).guestGroup.findMany({ where: { bookingId }, orderBy: { id: 'asc' } })
    ).map((row) => {
      return {
        guestGroupId: row.id,
        name: row.name,
        color: row.color,
        status: row.status as 'ACTIVE' | 'ARCHIVED',
      };
    });
  }
  async getGuestListSummary(bookingValue: string) {
    const bookingId = parse(id, bookingValue);
    const snapshot = await this.guests.repository.prisma.guestOutbox.findFirst({
      where: { bookingId },
      orderBy: { sourceSequence: 'desc' },
    });
    if (snapshot === null) throw new NotFoundError();
    return {
      listedGuestCount: parse(reportSchema, snapshot.payload).listedGuestCount,
      sourceSequence: snapshot.sourceSequence,
    };
  }
  private async authorizeOperations(bookingId: string, context: GuestRequestContext) {
    const actor = await this.guests.resolver.resolve(context.accessToken);
    if (actor.accountId !== context.actorId) throw new NotFoundError();
    if (this.staff !== undefined && actor.roles.some((r) => r === 'MANAGER' || r === 'STAFF')) {
      await this.staff.requireAssignedOperationsAccess(bookingId, context);
      return;
    }
    if (actor.roles.includes('MANAGER')) return this.guests.authorize(bookingId, context);
    if (!actor.roles.includes('STAFF') || this.staff === undefined) throw new NotFoundError();
    await this.staff.requireAssignedOperationsAccess(bookingId, context);
  }
  async search(bookingValue: string, value: unknown, context: GuestRequestContext) {
    const bookingId = parse(id, bookingValue),
      input = parse(searchQuerySchema, value);
    return this.operations(bookingId, context, async (tx) => {
      const workspace = await tx.guestWorkspace.findUnique({ where: { bookingId } });
      const sequence = workspace?.listSequence ?? 0;
      const query = normalizeGroupName(input.query),
        filter = { bookingId, query };
      const after = cursor(input.cursor, sequence, filter);
      const rank = after?.rank ?? -1,
        afterId = after?.id ?? '00000000-0000-0000-0000-000000000000';
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          guestGroupId: string;
          name: string;
          phone: string | null;
          rank: number;
        }>
      >`
        WITH matches AS (SELECT id,"guestGroupId",name,phone,
          CASE WHEN "normalizedName"=${query} OR phone=${query} THEN 0
            WHEN starts_with("normalizedName",${query}) OR starts_with(phone,${query}) THEN 1 ELSE 2 END AS rank
          FROM "Guest" WHERE "bookingId"=${bookingId}::uuid AND status='ACTIVE'
            AND (strpos("normalizedName",${query})>0 OR strpos(phone,${query})>0))
        SELECT * FROM matches WHERE rank>${rank} OR (rank=${rank} AND id>${afterId}::uuid)
        ORDER BY rank,id LIMIT ${input.limit + 1}`;
      const last = rows[input.limit - 1];
      return {
        sourceSequence: sequence,
        items: rows.slice(0, input.limit).map((r) => ({
          guestId: r.id,
          guestGroupId: r.guestGroupId,
          name: r.name,
          phoneLast4: r.phone?.slice(-4) ?? null,
        })),
        nextCursor:
          rows.length > input.limit && last
            ? encode({ id: last.id, rank: last.rank, sequence, filterDigest: digest(filter) })
            : null,
      };
    });
  }
  async requireGuestForOperations(guestValue: string, context: GuestRequestContext) {
    const guestId = parse(id, guestValue);
    const reference = await (
      this.guests.repository.boundary.current() ?? this.guests.repository.prisma
    ).guest.findUnique({
      where: { id: guestId },
    });
    if (reference === null) throw new NotFoundError();
    return this.operations(reference.bookingId, context, async (tx) => {
      const row = await this.guests.requireGuest(tx, reference.bookingId, guestId);
      if (row.status !== 'ACTIVE') throw new NotFoundError();
      return {
        bookingId: row.bookingId,
        guestId: row.id,
        guestGroupId: row.guestGroupId,
        name: row.name,
        disambiguatingPhone: row.phone,
        operationalNote: row.operationalNote,
      };
    });
  }
  async readReportPage(bookingValue: string, value: unknown, context: ContractContext) {
    const bookingId = parse(id, bookingValue);
    const input = parse(
      z.strictObject({
        afterSequence: z.int().nonnegative(),
        throughSequence: z.int().nonnegative().optional(),
        limit: z.int().min(1).max(50),
      }),
      value,
    );
    if (
      context.authority !== 'SYSTEM' ||
      context.actorAccountId !== null ||
      !['reporting:guest-management', 'reporting:rebuild'].includes(context.purpose ?? '')
    )
      throw new NotFoundError();
    return this.guests.repository.prisma.$transaction(async (tx) => {
      const head = await tx.guestOutbox.findFirst({
        where: { bookingId },
        orderBy: { sourceSequence: 'desc' },
      });
      const fence = input.throughSequence ?? head?.sourceSequence ?? 0;
      if (fence > (head?.sourceSequence ?? 0) || fence < input.afterSequence)
        throw new ValidationError();
      const rows = await tx.guestOutbox.findMany({
        where: { bookingId, sourceSequence: { gt: input.afterSequence, lte: fence } },
        orderBy: { sourceSequence: 'asc' },
        take: input.limit + 1,
      });
      return {
        throughSequence: fence,
        nextAfterSequence: rows.length > input.limit ? rows[input.limit - 1]!.sourceSequence : null,
        rows: rows.slice(0, input.limit).map((r) => ({
          recordId: bookingId,
          sequence: r.sourceSequence,
          changedAt: r.createdAt.toISOString(),
          value: parse(reportSchema, r.payload),
        })),
      };
    });
  }
  async prepareDelivery(
    value: GuestDeliveryRecipient,
    context: GuestRequestContext,
  ): Promise<GuestDeliveryPreparation> {
    const input = parse(
      z.strictObject({ bookingId: id, guestId: id, intendedEmail: z.email().max(254) }),
      value,
    );
    return this.guests.read(input.bookingId, context, async (tx) => {
      const guest = await this.guests.requireGuest(tx, input.bookingId, input.guestId);
      const credential = await tx.guestInvitationCredential.findFirst({
        where: {
          bookingId: input.bookingId,
          guestId: guest.id,
          revokedAt: null,
          expiresAt: { gt: this.guests.now() },
        },
        orderBy: { revision: 'desc' },
      });
      if (
        guest.status !== 'ACTIVE' ||
        credential === null ||
        this.guests.owners.invitation === undefined
      )
        throw new NotFoundError();
      const invitation = await this.guests.owners.invitation.getCurrent(
        input.bookingId,
        credential.publicInvitationId,
      );
      return {
        intendedEmail: input.intendedEmail,
        credentialId: credential.id,
        publicInvitationId: invitation.publicInvitationId,
        publishedRevisionId: invitation.publishedRevisionId,
        expiresAt: credential.expiresAt.toISOString(),
      };
    });
  }
  async isDeliveryCurrent(
    bookingId: string,
    credentialId: string,
    context: ContractContext,
  ): Promise<boolean> {
    if (
      context.authority !== 'SYSTEM' ||
      context.actorAccountId !== null ||
      context.purpose !== 'notifications:guest-delivery'
    )
      return false;
    const tx = this.guests.repository.prisma;
    const credential = await tx.guestInvitationCredential.findFirst({
      where: { id: credentialId, bookingId, revokedAt: null, expiresAt: { gt: this.guests.now() } },
    });
    if (credential === null || this.guests.owners.invitation === undefined) return false;
    const guest = await tx.guest.findFirst({
      where: { id: credential.guestId, bookingId, status: 'ACTIVE' },
    });
    if (guest === null) return false;
    try {
      await this.guests.owners.planning.requireInvitationViewContext(bookingId);
      await this.guests.owners.invitation.getCurrent(bookingId, credential.publicInvitationId);
      return true;
    } catch {
      return false;
    }
  }
}
