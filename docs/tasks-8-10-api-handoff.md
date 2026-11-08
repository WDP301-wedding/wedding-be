# Tasks 8/10 API and release hand-off

Scope: [owner-approved requirements](tasks-8-10-dashboard-deposit-2026-11-08.md).
Local implementation is on `codex/tasks-8-10-dashboard-deposit` in wedding-be,
wedding-manage-web, wedding-web and PRM-app. No provider SDK or dependency changed.

## Completed-event report

`GET /api/v1/management/analytics/completed-events`

```text
?dateFrom=2026-11-01&dateTo=2026-11-30&paymentStatus=DEBT&page=1&pageSize=10
```

Active Manager only; authorization is rechecked before response. Couple/Staff get
403; anonymous gets 401. Response is `Cache-Control: no-store`. Dates are inclusive
Asia/Ho_Chi_Minh event dates, at most 366 days. Optional `hallId` and `q` restrict
the cohort. `paymentStatus=ALL|PAID|DEBT` filters the event table only, preserving
summary and ranking denominators. Page and page size are bounded integers; SQL
filters and pages before returning at most 100 event rows. Aggregate budgets are
10,000 completed events and 10,000 distinct offerings; overflow/broad scope is 422.

The response contains `meta`, `summary`, `halls`, `offerings`, `items` and numbered
pagination. `definitionVersion=COMPLETED_INVOICE_V1` distinguishes these definitions
from the existing cash reports, which keep their original semantics. Source counters
are captured with the owner facts in one SQL statement snapshot. No public endpoint
or attendance-derived metric is added. OpenAPI contains exact strict DTOs.

- Revenue = latest finalized invoice total of COMPLETED events, including subsequent
  finalized invoice adjustments. Unfinalized event values are provisional, excluded
  from revenue, and never labeled PAID.
- Net paid = Payments' proven settled payments minus refunds. Outstanding and credit
  use Payments' published totals, which already include every CREDIT_ADJUSTMENT.
  Retained legacy invoices never override later ledger credits.
- Hall usage = completed-event count. Share = hall count / selected completed count.
  Zero-use active halls remain visible; historical retired halls remain reportable.
- Item selection count = distinct completed bookings per category + stable source ID.
  Quantities use frozen effective commercial lines. Item revenue uses finalized
  commercial line totals, grouped across catalog revisions. Current catalog prices
  never reprice historical selections. General expenses, printing and unallocated
  invoice adjustments appear in a separate reconciliation amount.
- Unknown financial sources produce nullable amounts and SOURCE_NOT_READY, rather
  than manufactured zero attendance, payment, or debt.

## Prospective deposit policy

Manager reads/updates `depositPercentage` through the existing restaurant catalog
GET/PATCH routes. PATCH retains `expectedRevision` and existing Manager authority;
an omitted percentage preserves configuration. The public catalog GET also exposes
the percentage as a quote preview, not a promise for an existing booking.

```json
{
  "displayName": "Nhà hàng Hỷ Yến",
  "description": "Mô tả nhà hàng",
  "address": "Thành phố Hồ Chí Minh",
  "publicPhone": null,
  "publicEmail": null,
  "depositPercentage": 50,
  "expectedRevision": 4
}
```

The database locks the profile during booking insertion and freezes its percentage
and source revision. A concurrent configuration update causes a bounded retry of
the complete rolled-back booking creation transaction, retaining the booking ID
and consultation CAS. Subsequent configuration changes cannot edit this snapshot.

New proposal responses expose `proposal.depositPercentage`. New commercial contract
documents expose optional `depositRate`; absent historical fields mean 30%. Existing
bookings retain 30% and omit the document field when rebuilding an old draft, keeping
prior canonical digests valid. Contract revisions and payment eligibility use:

```text
depositAmountVnd = ceil(contractTotalVnd * frozenPercentage / 100)
```

Calculation uses checked integer VND and BigInt, never client totals or a percentage
inferred from rounded money. PDF clause 5.1 shows the frozen percentage/amount;
clause 5.2 shows the remaining contractual amount before post-event costs. Existing
approved documents, retained PDF bytes, signatures/approvals and settlements stay
immutable. Existing idempotency, unresolved-payment pins and refund rules remain.

## Migrations and coordinated release

1. `20261108040000_prospective_deposit_policy`: additive dedicated policy columns,
   new-booking snapshot guards and extended exact-amount constraints. Existing rows
   get compatibility defaults; no historical money/document is rewritten.
2. `20261108041000_archive_duplicate_mc_service`: append an inactive revision only
   for the current exact label `Dịch vụ MC`, with SYSTEM audit. Keep old references,
   prices and history. `MC tiệc cưới` is unchanged.
3. `20261108042000_completed_invoice_reporting`: publish finalized line facts,
   retained legacy invoice evidence and venue names. Append updated reporting facts;
   never update/delete historical facts. An index supports latest owner reads.

Apply these forward migrations to the authorized target with the matching backend
and clients. The service removal is effective on a target only after its migration
runs. No shared/production database has been modified during local implementation.

Released frontend OpenAPI pins remain unchanged. The additive dashboard DTO and
percentage fields are runtime validated locally. Repin generated clients only after
an actual backend release exists. Roll back application versions only after checking
whether variable-rate documents have been issued: the old fixed-30 backend cannot
read new variable-rate contracts. Preserve additive columns, invoice history and
retained evidence; never reset a database or rewrite an applied migration.
