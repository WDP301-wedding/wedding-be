import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import type { ReportingOwner } from '../../../core/reporting/reporting-feed.js';
import {
  bookingAnalyticsSchema,
  type BookingAnalyticsRow,
} from '../../booking-lifecycle/application/analytics-reporting.js';
import {
  billingAnalyticsSchema,
  type BillingAnalyticsRow,
} from '../../payments-billing/application/analytics-reporting.js';
import { attendanceSchema } from '../../staff-operations/application/attendance-readers.js';
import { cashWindow, sumVnd, attendanceResult } from '../domain/metrics.js';
import { type AnalyticsProjector, type Projection, type ProjectionStore } from './projection.js';
import {
  analyticsQuerySchema,
  type AnalyticsQuery,
  type AnalyticsReport,
} from '../http/analytics.schemas.js';
import { availabilitySchema } from '../../venue-catalog/application/analytics-reporting.js';
import { printAnalyticsSchema } from '../../invitation-studio/application/analytics-reporting.js';
const guestSchema = z.strictObject({
  bookingId: z.uuid(),
  planningHeadcount: z.int().nonnegative(),
  listedGuestCount: z.int().nonnegative(),
  planSourceSequence: z.int().nonnegative(),
});
const cursorSchema = z.strictObject({
  generationId: z.uuid(),
  filterDigest: z.string().length(64),
  after: z.uuid(),
});
const filterDigest = (q: AnalyticsQuery, report: AnalyticsReport, scope: string) =>
  createHash('sha256')
    .update(JSON.stringify({ ...q, cursor: undefined, report, scope }))
    .digest('hex');
const dependencies: Record<AnalyticsReport, ReportingOwner[]> = {
  overview: ['booking', 'billing', 'venue'],
  revenue: ['booking', 'billing'],
  bookings: ['booking', 'venue'],
  attendance: ['booking', 'guest', 'staff'],
  'print-orders': ['booking', 'invitation'],
};
export class AnalyticsService {
  // Only in-flight work is shared; responses and authority are never cached.
  private readonly refreshing = new Map<string, Promise<string>>();
  constructor(
    readonly projector: AnalyticsProjector,
    readonly store: ProjectionStore,
    readonly now: () => Date = () => new Date(),
    readonly invalidated: (p: Projection) => Promise<boolean> = () => Promise.resolve(false),
  ) {}
  async query(report: AnalyticsReport, value: unknown, context: ContractContext) {
    const parsed = analyticsQuerySchema.safeParse(value);
    if (!parsed.success) throw new ValidationError();
    const q = parsed.data,
      scope = context.actorAccountId!;
    if (q.cursor !== undefined) {
      try {
        cursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new ValidationError();
      }
    }
    const window = cashWindow(q.dateFrom, q.dateTo);
    const filter = {
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      cashFrom: window.from,
      cashTo: window.to,
      ...(q.hallId ? { hallId: q.hallId } : {}),
      ...(q.phase ? { phase: q.phase } : {}),
      ...(q.menuPackageId ? { menuPackageId: q.menuPackageId } : {}),
      includeCash: report === 'overview' || report === 'revenue',
      includeUtilization: report === 'overview' || report === 'bookings',
      owners: dependencies[report],
    };
    let projection = await this.store.load(scope, true, filter);
    const fresh = projection?.checkpoints.every(
      (c) =>
        c.status === 'READY' &&
        c.refreshedAt !== null &&
        this.now().getTime() - Date.parse(c.refreshedAt) < 60000,
    );
    if (
      (!fresh || (projection && (await this.invalidated(projection)))) &&
      q.cursor === undefined
    ) {
      try {
        let pending = this.refreshing.get(scope);
        if (pending === undefined) {
          pending = this.projector.refresh(scope, context);
          this.refreshing.set(scope, pending);
        }
        try {
          await pending;
        } finally {
          if (this.refreshing.get(scope) === pending) this.refreshing.delete(scope);
        }
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'ANALYTICS_REFRESH_CONFLICT'))
          throw error;
      }
      projection = await this.store.load(scope, true, filter);
    }
    if (!projection)
      throw new AppError({
        status: 503,
        code: 'ANALYTICS_NOT_READY',
        message: 'Analytics sources are unavailable.',
      });
    const meta = this.meta(projection, report, q);
    const read = <T>(owner: ReportingOwner, schema: z.ZodType<T>) => {
      const rows = projection.rows.filter((r) => r.owner === owner);
      if (rows.length > 10000)
        throw new AppError({
          status: 422,
          code: 'ANALYTICS_QUERY_TOO_BROAD',
          message: 'The report exceeds its 10,000-row bound.',
        });
      return rows.map((r) => schema.parse(r.value));
    };
    const bookings = read('booking', bookingAnalyticsSchema);
    const selected = bookings.filter((b) => this.matches(b, q, true));
    const ids = new Set(selected.map((b) => b.bookingId));
    if (report === 'revenue' || report === 'overview') {
      const billing = read('billing', billingAnalyticsSchema);
      const amounts = this.money(bookings, billing, q, projection);
      if (report === 'revenue') return { meta, ...amounts };
      return {
        meta,
        ...amounts,
        ...this.bookingMetrics(selected, bookings, read('venue', availabilitySchema), q),
      };
    }
    if (report === 'bookings')
      return {
        meta,
        ...this.page(
          selected.map((b) => ({
            bookingId: b.bookingId,
            eventDate: b.eventDate,
            hallId: b.hallId,
            hallNameSnapshot: b.hallNameSnapshot,
            shiftCode: b.shiftCode,
            phase: b.phase,
            tableCount: b.commercialLines.some((l) => l.category === 'MENU')
              ? sumVnd(
                  b.commercialLines.filter((l) => l.category === 'MENU').map((l) => l.quantity),
                )
              : b.tableCount,
          })),
          (r) => r.bookingId,
          projection,
          q,
          report,
          scope,
        ),
        ...this.bookingMetrics(selected, bookings, read('venue', availabilitySchema), q),
      };
    if (report === 'attendance') {
      const guests = new Map(read('guest', guestSchema).map((r) => [r.bookingId, r]));
      const staff = new Map(read('staff', attendanceSchema).map((r) => [r.bookingId, r]));
      const items = selected.map((b) => {
        const g = guests.get(b.bookingId),
          s = staff.get(b.bookingId);
        const row = attendanceResult(
          b.bookingId,
          g?.planningHeadcount ?? b.planningHeadcount,
          g?.listedGuestCount ?? 0,
          s,
        );
        return {
          ...row,
          listedGuestCount: g?.listedGuestCount ?? null,
          ...(s
            ? {}
            : {
                checkInMode: null,
                measurementStatus: 'SOURCE_NOT_READY' as const,
                checkedInGuestCount: null,
              }),
        };
      });
      return { meta, ...this.page(items, (r) => r.bookingId, projection, q, report, scope) };
    }
    const prints = read('invitation', printAnalyticsSchema).filter((r) => ids.has(r.bookingId));
    return {
      meta,
      ...this.page(
        prints.map((r) => ({
          bookingId: r.bookingId,
          printOrderId: r.printOrderId,
          status: r.status,
          acceptedAmountVnd: r.acceptedAmountVnd,
          receivableChargeId: r.receivableChargeId,
        })),
        (r) => r.printOrderId,
        projection,
        q,
        report,
        scope,
      ),
      statusCounts: this.counts(prints.map((r) => r.status)),
    };
  }
  private meta(p: Projection, report: AnalyticsReport, q: AnalyticsQuery) {
    const checkpoints = p.checkpoints
      .filter((c) => dependencies[report].includes(c.owner))
      .map((c) => ({
        ...c,
        status:
          c.status === 'READY' &&
          c.refreshedAt &&
          this.now().getTime() - Date.parse(c.refreshedAt) >= 60000
            ? ('STALE' as const)
            : c.status,
      }));
    const times = checkpoints.flatMap((c) => (c.refreshedAt ? [c.refreshedAt] : [])).sort();
    return {
      metricDefinitionVersion: '2' as const,
      providerVersion: 'ANALYTICS-SOURCES@3.0.0' as const,
      timezone: 'Asia/Ho_Chi_Minh' as const,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      generationId: p.generationId,
      refreshedAt: times[0] ?? null,
      sourceCheckpoints: checkpoints,
      status: checkpoints.some((c) => c.status === 'SOURCE_NOT_READY')
        ? ('SOURCE_NOT_READY' as const)
        : checkpoints.some((c) => c.status === 'STALE')
          ? ('STALE' as const)
          : ('READY' as const),
    };
  }
  private matches(b: BookingAnalyticsRow, q: AnalyticsQuery, eventDate: boolean) {
    return (
      (!eventDate || (b.eventDate >= q.dateFrom && b.eventDate <= q.dateTo)) &&
      (!q.hallId || q.hallId === b.hallId) &&
      (!q.phase || q.phase === b.phase) &&
      (!q.menuPackageId ||
        b.commercialLines.some((l) => l.category === 'MENU' && l.sourceId === q.menuPackageId) ||
        (b.commercialLines.length === 0 && b.menuPackageId === q.menuPackageId))
    );
  }
  private money(
    bookings: BookingAnalyticsRow[],
    billing: BillingAnalyticsRow[],
    q: AnalyticsQuery,
    p: Projection,
  ) {
    const window = cashWindow(q.dateFrom, q.dateTo),
      byId = new Map(bookings.map((b) => [b.bookingId, b]));
    const eventRows = billing.filter(
      (r) => byId.has(r.bookingId) && this.matches(byId.get(r.bookingId)!, q, true),
    );
    const cashRows = billing.filter(
      (r) => byId.has(r.bookingId) && this.matches(byId.get(r.bookingId)!, q, false),
    );
    const entries = cashRows
      .flatMap((r) => r.ledger)
      .filter(
        (e) =>
          Date.parse(e.occurredAt) >= Date.parse(window.from) &&
          Date.parse(e.occurredAt) < Date.parse(window.to),
      );
    const received = sumVnd(entries.filter((e) => e.kind === 'PAYMENT').map((e) => e.amountVnd));
    const refunded = sumVnd(entries.filter((e) => e.kind === 'REFUND').map((e) => e.amountVnd));
    const selected = bookings.filter((b) => this.matches(b, q, true));
    const billingReady = Boolean(p.checkpoints.find((c) => c.owner === 'billing')?.refreshedAt);
    const bookingReady = Boolean(p.checkpoints.find((c) => c.owner === 'booking')?.refreshedAt);
    const cashReady = billingReady && bookingReady;
    return {
      currency: 'VND' as const,
      cashFromUtc: window.from,
      cashToExclusiveUtc: window.to,
      grossCashReceivedVnd: cashReady ? received : null,
      cashRefundedVnd: cashReady ? refunded : null,
      netCashRevenueVnd: cashReady ? sumVnd([received, -refunded]) : null,
      receivablesVnd: cashReady ? sumVnd(eventRows.map((r) => r.outstandingVnd)) : null,
      creditBalanceVnd: cashReady ? sumVnd(eventRows.map((r) => r.creditVnd)) : null,
      acceptedChargesVnd: cashReady ? sumVnd(eventRows.map((r) => r.acceptedChargesVnd)) : null,
      settledPaymentsVnd: cashReady ? sumVnd(eventRows.map((r) => r.paidVnd)) : null,
      settledRefundsVnd: cashReady ? sumVnd(eventRows.map((r) => r.refundedVnd)) : null,
      netSettledVnd: cashReady
        ? sumVnd(eventRows.flatMap((r) => [r.paidVnd, -r.refundedVnd]))
        : null,
      originalContractTotalVnd: bookingReady
        ? sumVnd(selected.map((b) => b.originalContractTotalVnd ?? 0))
        : null,
      approvedAppendixDeltaVnd: bookingReady
        ? sumVnd(selected.map((b) => b.approvedAppendixDeltaVnd))
        : null,
      effectiveAgreedTotalVnd: bookingReady
        ? sumVnd(selected.map((b) => b.effectiveAgreedTotalVnd ?? 0))
        : null,
      finalizedIncidentalTotalVnd: cashReady
        ? sumVnd(eventRows.map((r) => r.finalizedIncidentalTotalVnd ?? 0))
        : null,
      finalInvoiceTotalVnd: cashReady
        ? sumVnd(eventRows.map((r) => r.finalInvoiceTotalVnd ?? 0))
        : null,
      finalizedInvoiceCount: cashReady
        ? eventRows.filter((r) => r.finalInvoiceRevisionId !== null).length
        : null,
    };
  }
  private counts(statuses: string[]) {
    return [...new Set(statuses)]
      .sort()
      .map((status) => ({ status, count: statuses.filter((s) => s === status).length }));
  }
  private bookingMetrics(
    selected: BookingAnalyticsRow[],
    all: BookingAnalyticsRow[],
    venue: z.infer<typeof availabilitySchema>[],
    q: AnalyticsQuery,
  ) {
    const committed = selected.filter((b) => ['CONFIRMED', 'COMPLETED'].includes(b.phase));
    const popularity = (category: 'MENU' | 'SERVICE') => {
      const map = new Map<
        string,
        {
          sourceId: string;
          sourceRevisionId: string | null;
          nameSnapshot: string;
          ids: Set<string>;
          quantity: number;
        }
      >();
      for (const b of committed) {
        const lines = b.commercialLines.filter((l) => l.category === category);
        if (category === 'MENU' && b.commercialLines.length === 0 && b.menuPackageId)
          lines.push({
            category: 'MENU',
            sourceId: b.menuPackageId,
            sourceRevisionId: b.menuPackageId,
            name: b.menuNameSnapshot ?? '',
            quantity: b.tableCount,
          });
        for (const line of lines) {
          const key = line.sourceId + '/' + line.sourceRevisionId;
          const row = map.get(key) ?? {
            sourceId: line.sourceId,
            sourceRevisionId: b.commercialLines.length ? line.sourceRevisionId : null,
            nameSnapshot: line.name,
            ids: new Set<string>(),
            quantity: 0,
          };
          row.ids.add(b.bookingId);
          row.quantity = sumVnd([row.quantity, line.quantity]);
          map.set(key, row);
        }
      }
      return [...map.values()]
        .map((r) => ({
          sourceId: r.sourceId,
          sourceRevisionId: r.sourceRevisionId,
          nameSnapshot: r.nameSnapshot,
          bookingCount: r.ids.size,
          quantity: r.quantity,
        }))
        .sort(
          (a, b) =>
            a.sourceId.localeCompare(b.sourceId) ||
            String(a.sourceRevisionId).localeCompare(String(b.sourceRevisionId)),
        );
    };
    const occupied = new Set(
      all
        .filter(
          (b) =>
            ['CONFIRMED', 'COMPLETED'].includes(b.phase) &&
            b.eventDate >= q.dateFrom &&
            b.eventDate <= q.dateTo &&
            (!q.hallId || b.hallId === q.hallId),
        )
        .map((b) => b.hallId + '/' + b.eventDate + '/' + b.shiftCode),
    ).size;
    let available = 0,
      ready = true;
    for (let day = Date.parse(q.dateFrom); day <= Date.parse(q.dateTo); day += 86400000) {
      const midnight = day - 7 * 3600000;
      const snapshot = venue
        .filter((v) => Date.parse(v.observedAt) <= midnight)
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
      if (!snapshot) {
        ready = false;
        break;
      }
      available +=
        snapshot.halls.filter((h) => h.active && (!q.hallId || h.id === q.hallId)).length *
        snapshot.shifts.filter((s) => s.active).length;
    }
    // Independent owner fences may briefly disagree about a retired/occupied slot.
    // A ratio above 100% is not evidence of historical available inventory.
    if (occupied > available) ready = false;
    return {
      bookingStatusCounts: this.counts(selected.map((b) => b.phase)),
      menuPopularity: popularity('MENU'),
      servicePopularity: popularity('SERVICE'),
      hallUtilization: {
        occupiedSlots: occupied,
        availableSlots: ready ? available : null,
        rate: ready && available > 0 ? occupied / available : null,
        status: !ready
          ? ('SOURCE_NOT_READY' as const)
          : available === 0
            ? ('NO_AVAILABLE_SLOTS' as const)
            : ('READY' as const),
      },
    };
  }
  private page<T>(
    items: T[],
    id: (r: T) => string,
    p: Projection,
    q: AnalyticsQuery,
    report: AnalyticsReport,
    scope: string,
  ) {
    const digest = filterDigest(q, report, scope);
    let after = '';
    if (q.cursor !== undefined) {
      let c;
      try {
        c = cursorSchema.parse(JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new ValidationError();
      }
      if (c.generationId !== p.generationId || c.filterDigest !== digest)
        throw new AppError({
          status: 409,
          code: 'ANALYTICS_CURSOR_STALE',
          message: 'The cursor generation or filters changed.',
        });
      after = c.after;
    }
    const rows = items.filter((r) => id(r) > after).sort((a, b) => id(a).localeCompare(id(b)));
    return {
      items: rows.slice(0, q.pageSize),
      nextCursor:
        rows.length > q.pageSize
          ? Buffer.from(
              JSON.stringify({
                generationId: p.generationId,
                filterDigest: digest,
                after: id(rows[q.pageSize - 1]!),
              }),
            ).toString('base64url')
          : null,
    };
  }
}
