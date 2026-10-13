# SPEC-10 analytics backend hand-off

Provider: **ANALYTICS-SOURCES@3.0.0**. Metric definition: **2**.
Scope: backend developer implementation for ANL-W1–W4, single restaurant.
See [acceptance evidence](../tasks/evidence/analytics-dashboard-w1-w4-2026-10-13.md)
and the [immutable source/API manifest](../tasks/evidence/analytics-dashboard-provider-manifest-2026-10-13.json).
Frontend delivery, deployment, live payment/provider evidence and RV-21 remain separate.

## HTTP contract

All paths have prefix `/api/v1`, require a current active Manager bearer session,
and return `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Managers administer the one restaurant; cache/projection scope also includes their
account ID. Couple, Staff and invitation credentials cannot read or rebuild reports.

| Method | Path                                     | Result                                                                                      |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/management/analytics/overview`         | Cash, receivables, commercial/invoice amounts, statuses, historical utilization, popularity |
| GET    | `/management/analytics/revenue`          | Authoritative cash and event-date financial aggregates                                      |
| GET    | `/management/analytics/bookings`         | UUID-ordered booking page, statuses, utilization, immutable menu/service popularity         |
| GET    | `/management/analytics/attendance`       | Independent planning, named-list and mode-aware measured counts                             |
| GET    | `/management/analytics/print-orders`     | Current immutable print-order states and accepted presentation amounts                      |
| GET    | `/management/analytics/exports/overview` | Audited JSON aggregate attachment, same overview definitions                                |
| POST   | `/management/analytics/rebuild`          | Authorized shadow rebuild and audited generation ID                                         |

Required GET filters: inclusive local `dateFrom`, `dateTo` (`YYYY-MM-DD`), 1–366
days. The earliest local date is `0001-01-02`, keeping UTC instants in PostgreSQL's
supported AD era; iteration is bounded through year 9999. UUID filters normalize
to lowercase. Optional: `hallId`, `phase`, `menuPackageId`, `pageSize` (default 20, 1–100),
`cursor` (opaque, maximum 2,048 characters). Unknown fields and invalid calendar
dates fail 422. List pages sort by booking UUID or print-order UUID. Cursors bind
account scope, report, filters, page size and generation; changed generations or
filters return 409 `ANALYTICS_CURSOR_STALE`. Start a new first page on that response.
Aggregate endpoints should omit cursor. Rebuild body is strictly `{ "reason":
"Operator explanation" }`; it changes projection state only and is safe to rerun,
but each execution creates its own generation/audit. No money operation is exposed.

Examples:

```http
GET /api/v1/management/analytics/revenue?dateFrom=2026-10-13&dateTo=2026-10-13
Authorization: Bearer <Manager access token>

GET /api/v1/management/analytics/attendance?dateFrom=2026-10-13&dateTo=2026-10-13&pageSize=20
Authorization: Bearer <Manager access token>

POST /api/v1/management/analytics/rebuild
Authorization: Bearer <Manager access token>
Content-Type: application/json

{"reason":"Reconcile reporting source snapshots"}
```

Response envelope is `{ "data": ... }`. Every report has `meta` with timezone
`Asia/Ho_Chi_Minh`, dates, metric/provider versions, generation ID, oldest required
source refresh time, and individual `{ owner, throughSequence, refreshedAt, status }`
checkpoints. Status is `READY`, `STALE` or `SOURCE_NOT_READY`. Checkpoint sequences
are comparable only within the same owner. Successful empty results differ from
missing sources; unavailable money aggregates are null, not fabricated zero.

An attendance item for a wedding with no names/check-in is:

```json
{
  "bookingId": "10000000-0000-4000-8000-000000000001",
  "planningHeadcount": 300,
  "listedGuestCount": 0,
  "checkInMode": "NONE",
  "measurementStatus": "NOT_RECORDED",
  "checkedInGuestCount": null,
  "byGuestGroup": []
}
```

With an optional partial list, `listedGuestCount: 20`, mode `BY_GUEST_NAME` and
`measurementStatus: LISTED_GUESTS_ONLY`, measured count 0 is a known listed-person
zero. It is never a whole-event attendance total or denominator for turnout.
Missing Guest/Staff sources yield nullable list/mode fields and measurement status
`SOURCE_NOT_READY`. Group measurements keep the original Group label/color from
the Staff journal, including later-archived Guests. No Guest contacts, operational
notes, response metrics, access credentials, signed file URLs or callback data appear.
Companion counting remains deferred; these reports do not prohibit companions.

## Metric definitions

Cash dates translate to half-open UTC instants: local `2026-10-13` corresponds
to `[2026-10-12T17:00:00Z, 2026-10-13T17:00:00Z)`. Gross cash sums only PAYMENT
facts in that window; cash refunded sums REFUND facts; net cash subtracts refunds.
Hall/phase/menu filters select the corresponding bookings, without restricting
cash to weddings whose eventDate is in the cash period.

Receivables and credit sum Billing's published `outstandingVnd` and `creditVnd`
for eventDate-selected bookings. Analytics never calculates a new obligation.
`acceptedChargesVnd`, `settledPaymentsVnd`, `settledRefundsVnd` and `netSettledVnd`
are event-date-selected cumulative Billing facts as of the fence. They are separate
from cash received/refunded/net cash within the requested cash period.
Contract totals, mutually approved signed appendix deltas, effective agreed totals,
finalized incidental totals and latest final-invoice totals/counts are separate
event-date aggregates. Draft expenses/unapproved appendices are excluded.
Legacy bookings retain Billing truth; absent full-contract facts contribute no
invented full-contract amount. Contract-included print is not charged twice.
Amounts and aggregate arithmetic are checked safe integer VND; overflow is 422
`ANALYTICS_AMOUNT_OVERFLOW`.

Menu/service popularity counts distinct confirmed/completed bookings by effective
accepted source ID/version and historical name. Menu quantities are table counts;
service quantities retain their contracted quantity meaning. Legacy menu versions
remain nullable instead of being guessed from today's catalog. Booking statuses
use latest source phase and eventDate, independent of payment completeness.

Print metrics count current order states. `acceptedAmountVnd` is presentation only;
QUOTED/REQUESTED amounts are never added to Billing receivables. Billing snapshots
preserve accepted charges, cancellation credits, payments and refunds.

Historical utilization counts distinct confirmed/completed hall-date-shift slots.
Availability is the active Hall × active Shift inventory observed at local day
start, as of the Venue fence. Hall filter applies; phase/menu filters apply to
booking lists/popularity rather than changing inventory utilization. Snapshot
history starts when the forward migration observes Venue. Earlier dates return
`availableSlots: null`, `rate: null`, `SOURCE_NOT_READY`. A proven empty inventory
returns rate null with `NO_AVAILABLE_SLOTS`. Future dates use the latest inventory
known at the source fence; later catalog changes generate new observations.

## Sources, migrations, consistency and operations

Owner adapters live in Booking, Billing, Invitation, Guest, Staff and Venue. Strict
readonly DTOs are in their application contracts. Metric/query code consumes ports
and never imports Prisma or owner repositories. Owner feeds use `ReportingFact`
and locked `ReportingSequence` counters: `(owner, sequence)` uniquely identifies
each durable publication; record IDs are booking/order IDs or Venue observation
sequence. Transactional deferred triggers publish complete committed owner facts,
deduplicate unchanged records, and omit profile/contact/clause/expense-note data.
Existing reporting APIs remain unchanged; this is an additive commercial reporting
port. Source schemas reject unknown fields before projection publication.

Install all four new migrations in order:

1. `20261013001000_analytics_owner_feeds`: serialized owner counters, immutable
   minimal feeds, safe current backfill, real commercial/invoice/Guest/Staff/print
   sources and Venue observations.
2. `20261013002000_analytics_projection`: generation, head, row/checkpoint storage.
3. `20261013003000_reporting_scope_and_planning_invalidation`: bind feed functions
   to installation schema and accept the existing explicit-planning invalidation
   reason without editing historic migration/evidence.
4. `20261013004000_analytics_event_query_index`: index the projection's event-date
   and hall predicates for filtered report reads.

One owner-head SQL observation selects a consistent committed cut, without
comparing different owners' sequence numbers. Refresh stages every page through a fixed owner fence before advancing that
checkpoint. Duplicates and older rows cannot replace newer record sequences.
Source failure discards that owner's staged pages, preserves old rows/checkpoint,
and marks freshness stale/unavailable. Rebuild rereads immutable owner facts from
zero into a shadow generation; any source failure leaves the active generation
unchanged. Publication checks the expected prior generation under an advisory lock
and atomically switches head/rows/checkpoints. MVCC readers see a complete prior
or new generation. Concurrent publication loser returns 409
`ANALYTICS_REFRESH_CONFLICT`. Old projection generations are disposable; immutable
owner facts remain available for rebuild, without creating guest contact retention.

Runtime refresh interval is 60 seconds, with non-overlapping ticks and shutdown
draining before Prisma disconnect. A first-page query checks owner invalidation
and refreshes after changed facts; cursor pages retain the published generation
until a background/first-page refresh supersedes it. Source refresh has a maximum
2,000 pages of 500 rows per owner. PostgreSQL applies report/date/hall/phase/menu
predicates before row limits, retaining cash-related bookings outside event dates,
occupied slots independent of phase/menu and the prior Venue observation. Query
reads at most 60,001 matching projection rows and rejects beyond 60,000 total or
10,000 rows per required owner with 422
`ANALYTICS_QUERY_TOO_BROAD`; list output remains at most 100 rows. These are bounded
single-restaurant reports, not an unlimited warehouse. JSON exports contain one
aggregate result and audit filters/result size only; no spreadsheet/Guest export.

Errors: 401 current session missing/revoked/expired; 403 non-Manager; 409 stale
cursor/refresh race; 422 schema/range/row bound/overflow; 503 no usable generation
or failed rebuild. Internal/provider causes do not appear in error responses.
Runtime manifest records implementation/configuration separately from verification.

## Verification boundary

Use the checked-in unit, contract and PostgreSQL tests. Native integration creates
and deletes its own disposable databases; commercial acceptance uses controlled
manual receipts/gateways rather than live VNPay. No shared database, paid generation,
production-money operation or deployment is part of this acceptance. Exact results,
API SHA-256 and source hashes are in the linked evidence/manifest. Frontend owns
dashboard UI/client generation and integration with these DTOs separately.
