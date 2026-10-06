# Specification: Analytics Dashboard

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `analytics-dashboard` (`SPEC-10`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: Unassigned (next allocation round)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: OPS-003 and OPS-004
- Depends on: `venue-catalog`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-rsvp`, `seating-plan`, `staff-operations`
- Consumers: Management Web

## 1. Purpose and read-only boundary

This module provides Manager-only projections for KPIs, revenue, receivables, booking
status, hall utilization, menu popularity, print status, and expected-versus-actual
attendance by household and group. It owns projection/checkpoint metadata only. It never
writes domain state, counts draft quotations as receivables, recomputes provider money
truth, or infers exact table/seat occupancy.

## 2. Metric definitions and historical semantics

| Metric                            | Authoritative source                           | Non-negotiable interpretation                                 |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Revenue/paid/refunded/outstanding | payments ledger                                | Integer VND; accepted charge/payment/refund evidence only.    |
| Print receivable/status           | billing + invitation immutable revisions       | Draft/requested/quoted amount is not receivable.              |
| Booking status/utilization        | booking snapshots + catalog version references | Historical reports preserve event date/hall snapshot meaning. |
| Menu popularity                   | committed booking menu snapshot                | Never rewrite history from current catalog names/prices.      |
| Expected vs actual attendance     | guest expected revision + attendance ledger    | Group/household only; no personal seating inference.          |

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
time-zone boundaries, Manager denial, PII minimization, and parity between API and
Management Web presentation. It completes only after real staff-attendance source data
exists.

## 5. Exact KPI definitions and source hand-off

| KPI                  | Formula and period meaning                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gross cash received  | Sum PAYMENT ledger amounts whose settled occurredAt is inside the UTC-translated requested local-date range.                                                                               |
| Cash refunded        | Sum REFUND amounts whose recorded occurredAt is inside that same range.                                                                                                                    |
| Net cash revenue     | Gross cash received minus cash refunded for the cash period; never includes quotes or merely accepted charges.                                                                             |
| Receivables          | Sum latest provider outstandingVnd as of source fence for bookings whose eventDate is within requested event-date range.                                                                   |
| Credit balance       | Sum provider creditVnd for the same bookings; show separately, never hide it by clamping revenue.                                                                                          |
| Booking status count | Distinct bookingId by latest phase as of fence; filter uses eventDate, not confirmation or creation date.                                                                                  |
| Hall utilization     | Occupied confirmed/completed hall-date-shift slots divided by available active hall-date-shift slots for local event-date range. Cancelled/draft/awaiting-deposit do not occupy numerator. |
| Menu popularity      | Distinct confirmed/completed bookings by accepted snapshotted menuPackageId; optional tableCount sum shown as a separate metric.                                                           |
| Print status         | Count current print orders by state; accepted current commercial amount is presentation only, receivable comes from billing ledger.                                                        |
| Attendance           | Household expectation, planningContribution, actual ledger count, and actual − expectation; group totals aggregate their stable source group IDs.                                          |

No percent is produced when denominator is zero; return null with
`NO_AVAILABLE_SLOTS`. Utilization may be shown only if the catalog source can prove
active availability for each historical date/shift. The accepted
`VenueReportingReader` publishes the historical available-slot denominator;
current catalog names/active flags are not a substitute. If that source is unavailable,
return metric status `SOURCE_NOT_READY`, not a fabricated zero or current-state ratio.

Expected invited counts and RSVP planning contributions are displayed separately so a
declined invitation contributes zero to planning while its original household expectation
remains auditable. Actual attendance uses Staff's historical first-arrival group snapshot;
a later guest-group change is flagged and does not rewrite actual group history.
Household drill-down uses opaque household ID and approved display label only when
Manager private drill-down is requested; aggregate metrics never expose phone/note.

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
  metricDefinitionVersion: '1';
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
attendance returns cursor-paged household/group expectation/planning/actual/difference;
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

OPS-003 tests cover decline/pending/accepted planning, two arrivals/correction, group
rename/change history, and household totals. OPS-004 tests include quoted amount excluded,
accepted print charge, cancellation credit, replacement charge, and fulfillment state.
Source tests include midnight boundaries, same record newer sequence then older,
duplicate refresh, paged fence concurrency, source failure, and atomic rebuild switch.
Revenue/receivable examples are checked against the payment SPEC's ledger fixtures,
not an independent dashboard calculation of billing obligations.
