# Specification: Analytics Dashboard

> Current scope (confirmed 2026-10-10): [backend amendment](./docs/backend-scope-2026-10-10.md) and [active tasks](./tasks/backend-revision-todo.md). SPEC-06 onward has backend acceptance only; client implementation and visual/native checks belong to the frontend team. Earlier conflicting outlines are superseded.

- Status: **Business scope confirmed 2026-10-10 — backend implementation pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `analytics-dashboard` (`SPEC-10`)
- Contract baseline: `WEDDING-CONTRACT-3@3.0.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Sections 22/23 (2026-10-10); older conflicting contracts retained as history
- Initial owner role: Unassigned (next allocation round)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: OPS-003 and OPS-004
- Depends on: `venue-catalog`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-management`, `seating-plan`, `staff-operations`
- Consumers: Management Web

## 1. Purpose and read-only boundary

This module provides Manager-only projections for KPIs, revenue, receivables, booking
status, hall utilization, menu popularity, print status, independent planning totals,
optional named-list counts and measured check-ins by Guest/Group. It owns projection/checkpoint metadata only. It never
writes domain state, counts draft quotations as receivables, recomputes provider money
truth, or infers exact table/seat occupancy.

## 2. Metric definitions and historical semantics

| Metric                            | Authoritative source                                         | Non-negotiable interpretation                                                          |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Revenue/paid/refunded/outstanding | payments ledger                                              | Integer VND; accepted charge/payment/refund evidence only.                             |
| Print receivable/status           | billing + invitation immutable revisions                     | Draft/requested/quoted amount is not receivable.                                       |
| Booking status/utilization        | booking snapshots + catalog version references               | Historical reports preserve event date/hall snapshot meaning.                          |
| Menu popularity                   | committed booking menu snapshot                              | Never rewrite history from current catalog names/prices.                               |
| Planning/list/check-in counts     | explicit Guest plan + named-list source + Staff mode/journal | Independent totals; NONE is null/not recorded; enabled counts cover named Guests only. |

Every result declares time window, timezone, refresh/checkpoint freshness, source
definition version, and filtering semantics. Local-date filters use
`Asia/Ho_Chi_Minh`; storage/checkpoint times are UTC.

## 3. Inputs, projection behavior, and output contract

Sources are provider-approved read ports or baseline durable events. Every consumer is
idempotent by source event ID and stores a checkpoint/revision so delayed events cannot
replace newer projection state. Rebuild is deterministic from source facts and is an
authorized operational command, not a mutation of source records.

Specified Manager endpoints are `/management/analytics/overview`,
`/management/analytics/revenue`, `/management/analytics/bookings`,
`/management/analytics/attendance`, and `/management/analytics/print-orders`.
Responses are cursor/page or bounded aggregate results with a freshness field. They
never include raw guest phone, notes, access tokens, signed URLs, provider callback data,
or data from a booking the Manager is not authorized to see.

## 4. Security, audit, and acceptance

Manager role is checked in the backend on every view/export. Exports are approved only
for the minimum aggregate data required and are audited with filters and result size, not
row content. Dashboard cache keys must include Manager scope and query filters.

Acceptance proves each OPS-003/004 metric against known ledger/snapshot fixtures,
historical catalog changes, duplicate/out-of-order source events, source rebuild,
time-zone boundaries, Manager denial, PII minimization, and consistent examples in the
backend API and frontend hand-off. Verify real Staff mode/summary providers for both
NONE (not recorded) and enabled named-list measurements; a booking with no names or
check-in is a supported state, not a missing-source failure or fabricated zero.

## 5. Exact KPI definitions and source hand-off

| KPI                  | Formula and period meaning                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gross cash received  | Sum PAYMENT ledger amounts whose settled occurredAt is inside the UTC-translated requested local-date range.                                                                                                   |
| Cash refunded        | Sum REFUND amounts whose recorded occurredAt is inside that same range.                                                                                                                                        |
| Net cash revenue     | Gross cash received minus cash refunded for the cash period; never includes quotes or merely accepted charges.                                                                                                 |
| Receivables          | Sum latest provider outstandingVnd as of source fence for bookings whose eventDate is within requested event-date range.                                                                                       |
| Credit balance       | Sum provider creditVnd for the same bookings; show separately, never hide it by clamping revenue.                                                                                                              |
| Booking status count | Distinct bookingId by latest phase as of fence; filter uses eventDate, not confirmation or creation date.                                                                                                      |
| Hall utilization     | Occupied confirmed/completed hall-date-shift slots divided by available active hall-date-shift slots for local event-date range. Cancelled/draft/awaiting-deposit do not occupy numerator.                     |
| Menu popularity      | Distinct confirmed/completed bookings by accepted snapshotted menuPackageId; optional tableCount sum shown as a separate metric.                                                                               |
| Print status         | Count current print orders by state; accepted current commercial amount is presentation only, receivable comes from billing ledger.                                                                            |
| Attendance           | Independent planningHeadcount, active listedGuestCount and nullable checkedInGuestCount with mode/measurement status. Group check-ins use retained source Group snapshots, not a whole-event turnout estimate. |

No percent is produced when denominator is zero; return null with
`NO_AVAILABLE_SLOTS`. Utilization may be shown only if the catalog source can prove
active availability for each historical date/shift. The accepted
`VenueReportingReader` publishes the historical available-slot denominator;
current catalog names/active flags are not a substitute. If that source is unavailable,
return metric status `SOURCE_NOT_READY`, not a fabricated zero or current-state ratio.

PlanningHeadcount comes from the explicit ordered planning revision. ListedGuestCount
counts active named records independently; import/archive cannot change planning.
NONE returns NOT_RECORDED, checkedInGuestCount null and no measured Group rows.
Enabled returns LISTED_GUESTS_ONLY and distinct effective check-ins, including retained
records for later-archived Guests. A known zero before the first check-in is not the
same as disabled/unknown. No list is presumed complete; do not compute event turnout
or actual-minus-planned as if listed check-ins measured the whole wedding.

First-check-in Group snapshots preserve historical grouping after rename/reassignment.
Private Guest drill-down uses guestId and minimum authorized display label only when
requested; aggregate metrics never expose phone/note. There is no individual expected
quantity or inferred per-group attendance target from active membership counts.

## 6. Read-port DTOs, checkpoints, and rebuild

Consume the accepted baseline ports `BookingReportingReader`,
`BillingReportingReader`, `InvitationReportingReader`, `GuestReportingReader`,
`AttendanceReportingReader`, and `VenueReportingReader`. Each supplies strict
readonly source rows with owner sequence/fence/cursor. Metric code does not import
Prisma/provider repositories. Domain events invalidate or enqueue refresh; authoritative
read pages supply missing history/details rather than inventing fields absent from events.

Refresh every 60 seconds and after invalidating facts. Advance a provider checkpoint only
after all pages through its fence are atomically applied. A source error preserves prior
projection/checkpoint and marks that metric stale. Projection metadata records each
owner's throughSequence/refreshedAt; there is no global comparison of different sequences.
A rebuild uses a shadow projection generation then atomically switches after catch-up;
readers never see half an empty rebuilt dashboard.

Retention defaults to permanent aggregate/projection facts without guest contacts.
Data subject display identity belongs to provider minimization/retention; analytics does
not create a new PII retention copy. Reporting rows never include raw operational notes,
contact values, signed URLs, token hashes, or provider callback payload.

## 7. HTTP result and filter contract

All analytics endpoints require current Manager role. Required filters:
`dateFrom, dateTo` as inclusive local YYYY-MM-DD (1–366 days);
optional `hallId, phase, menuPackageId` where applicable. Backend translates cash
ranges to half-open UTC instants [local midnight dateFrom, local midnight dateTo + 1 day).
Currency is fixed VND. Sorting is deterministic, list pageSize 1–100, default 20.

Every result contains:

```typescript
type AnalyticsMeta = Readonly<{
  metricDefinitionVersion: '2';
  timezone: 'Asia/Ho_Chi_Minh';
  dateFrom: string;
  dateTo: string;
  refreshedAt: string | null;
  sourceCheckpoints: readonly Readonly<{
    owner: string;
    throughSequence: number;
    refreshedAt: string;
  }>[];
  status: 'READY' | 'STALE' | 'SOURCE_NOT_READY';
}>;
```

Overview returns cash/receivable/credit/status counters with these metadata;
attendance returns independent planning/list counts, check-in mode/measurement status
and nullable measured Guest/Group check-ins, not inferred whole-event differences;
hall utilization returns numerator/denominator/rate/null-reason. A filter with no matching
rows is a successful empty result, distinct from missing source data. Exports use the
same definitions and Manager scope, bounded 10,000 rows; no formula-capable guest text
is emitted into spreadsheet cells without safe escaping.

## 8. Parallel work and acceptance evidence

| Slice                                  | Can run alongside                                   | Real dependency                                                                               |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pure metric functions/DTO/schema tests | Staff/Notifications and source provider development | Known immutable fixtures and agreed formulas.                                                 |
| Individual source projector            | Other projectors/module screens                     | Its real paged reporting port at PROVIDER_READY.                                              |
| Management dashboard components        | Backend integration using local DTO fixtures        | Committed generated API before network adapter integration.                                   |
| Complete analytics acceptance          | Notifications need not be complete                  | Every required real reporting source, including attendance and historical venue availability. |

Proposed waves: formulas/source contracts; projection/checkpoint/rebuild;
Manager API/OpenAPI; dashboard/export presentation; acceptance (five).

OPS-003 tests cover no names/disabled check-in -> null; explicit planning 300 with
0/20 named Guests unchanged; enabled known zero versus disabled unknown; duplicate
check-in/undo; partial-list measurement labels; archived Guest/Group history and no
whole-event turnout inference. OPS-004 tests include quoted amount excluded,
accepted print charge, cancellation credit, replacement charge, and fulfillment state.
Source tests include midnight boundaries, same record newer sequence then older,
duplicate refresh, paged fence concurrency, source failure, and atomic rebuild switch.
Revenue/receivable examples are checked against the payment SPEC's ledger fixtures,
not an independent dashboard calculation of billing obligations.

## 10. Commercial and Final-Invoice Reporting

Read contract/appendix/expense/final-invoice facts through Booking/Billing ports.
Report agreed contract amounts, approved appendix deltas and incidental totals
separately, with final receivable, net settled/refunded amount, outstanding and credit.
Service popularity uses immutable contracted service versions/quantities. No draft
expense or unapproved appendix counts as receivable. Do not count contract-included
print charges twice. Guest reports separate explicit planning, optional named-list
counts and mode-aware measured check-ins;
no guest-response status, conversion, deadline or response-rate metric exists.
Backend acceptance uses real-source projection/query evidence and DTO/OpenAPI hand-off;
frontend dashboard implementation is a separate frontend deliverable.
