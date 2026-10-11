# BE-11–16: commercial settlement backend

Baseline: `main@07afed1`. Implementation branch: `codex/commercial-step-6`.
Acceptance evidence and final gate results are tracked in
[the step-six evidence](../tasks/evidence/be11-16-step6-results-2026-10-11.md).
This document describes implemented contracts; acceptance requires that evidence,
CI and a different team member's review before merging.

## Owners and persisted sources

Booking owns immutable appendix revisions, the effective commercial head and two
distinct Manager/Couple approvals on one digest. Payments owns expense drafts,
immutable `FINAL_INVOICE_V1` revisions and invoice balance pins. Invitation owns
actual template provenance and active print allocations. Owner readers enlist in
the existing serializable Booking unit of work; they do not rewrite another
owner's history.

The original `FULL_CONTRACT_V1` document and settled deposit remain unchanged.
Appendices freeze reason, exact effective predecessor, before/after lines and
signed delta. Unchanged lines retain their frozen catalog facts; changed lines
must select eligible current revisions. Approval two activates the effective
head and posts one `CONTRACT_APPENDIX` fact in the same transaction. Zero delta
does not create an artificial zero-value ledger fact.

Contracted print requests carry `commercialSource` with `agreementRevisionId`,
`offeringId` and `sourceRevisionId`. The server retains the selected material,
print type, template version and agreed unit price. Approval references the
original CONTRACT obligation, without a PRINT_ORDER charge. Active allocations
cannot exceed agreed quantity; an appendix cannot reduce below allocated
production quantities. Cancelling fulfillment does not credit the entire contract.
Replacement of contracted commercial content requires an approved appendix and
a new order; existing production history stays intact.

New design revisions record their real source template version. The optional
`templateVersionId` on design creation permits a retained template version only
when it belongs to the effective contracted print offering. Historical design
rows without recorded provenance remain null; no template identity is guessed.

## Expense and invoice API

All paths below are under `/api/v1`. Private reads use `Cache-Control: no-store`.
Writes require an authenticated Manager and `Idempotency-Key`; draft writes also
require `expectedRevision`. Couple has authorized FULL read access; Staff cannot
write. Missing/cross-booking resources are concealed by owner authorization.

| Method and path                                                              | Request / result                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET/POST `/bookings/{bookingId}/contract-appendices`                         | Own Manager or FULL Couple; paginated history / new reasoned draft                 |
| POST `/bookings/{bookingId}/contract-appendices/{revisionId}/submissions`    | Expected Booking revision; revalidate changed selections                           |
| POST `/bookings/{bookingId}/contract-appendices/{revisionId}/approvals`      | Expected Booking revision; distinct parties, atomic second approval                |
| GET `/bookings/{bookingId}/incidental-expenses`                              | Authorized draft read, including server total and finalized flag                   |
| GET/POST `/management/bookings/{bookingId}/incidental-expenses`              | Authorized read / Manager creates a draft line                                     |
| PATCH/DELETE `/management/bookings/{bookingId}/incidental-expenses/{lineId}` | Expected draft revision in JSON body                                               |
| POST `/management/bookings/{bookingId}/final-invoices`                       | `expectedDraftRevision`, `expectedCommercialRevisionId`, `expectedBillingRevision` |
| POST `/management/bookings/{bookingId}/invoice-adjustments`                  | `expectedInvoiceRevisionId`, `expectedBillingRevision`, reason, DEBIT/CREDIT lines |
| GET `/bookings/{bookingId}/final-invoices`                                   | Current head plus newest-first immutable history, 50/page, optional cursor         |
| GET `/bookings/{bookingId}/final-invoices/{invoiceRevisionId}`               | Exact retained invoice version                                                     |

An expense line has `name`, positive integer `quantity`, `unit`, nonnegative
integer `unitPriceVnd` and optional `note`. The server calculates `totalVnd` and
rejects fractional money, overflow and client-provided totals. Mutation requires
the authoritative event end in Vietnam time, a CONFIRMED/COMPLETED non-cancelled
booking and an unfinalized draft. It does not wait for the separate +12-hour
completion job. Draft changes write audit facts and do not post receivables.

Finalization freezes the original contract, all approved appendices, exact
expense revision/lines and total. Zero expenses are supported. CONTRACT and
appendix obligations are referenced; only new incidental charges are posted as
`INCIDENTAL_FINALIZATION`. Head activation, ledger, audit and outbox commit
together. Existing `BillingInvoice` ledger snapshots remain a legacy surface;
they are not the itemized final invoice.

Later adjustments retain all original sources and append reasoned immutable
DEBIT/CREDIT lines, actor/time and exact predecessor in a new invoice revision.
The signed adjustment posts once as `INVOICE_ADJUSTMENT`; total cannot become
negative. A CREDIT line does not record a refund. Refund execution remains the
existing explicit Manager approval/manual-evidence workflow.

## Balance and compatibility

```text
invoiceTotal = originalContractTotal + approvedAppendixDeltas + expenses + adjustments
netPaid = settledPayments - completedRefunds
outstanding = max(invoiceTotal - netPaid, 0)
credit = max(netPaid - invoiceTotal, 0)
```

New full-contract BALANCE attempts require the current final invoice. They retain
`invoiceRevisionId`, `invoiceDigest` and the billing revision at attempt creation.
VNPay collects the current whole outstanding amount; manual payments may collect
part of it under the existing amount limit. Attempt status exposes these pins
for new invoice-backed balances. Provider callbacks apply the retained amount
once; they never recalculate it from a later catalog or invoice.

CREATED/PENDING/UNKNOWN attempts and successful-but-unapplied payments block
conflicting monetary revisions until verified reconciliation. Expiry alone does
not unlock them. Legacy BASE/PRINT obligations, balance behavior and historical
attempts retain their recorded sources, without an inferred invoice backfill.

Representative conflicts: `COMMERCIAL_PREDECESSOR_STALE`,
`CONTRACT_REVISION_STALE`, `CONTRACT_PRINT_SOURCE_CONFLICT`,
`CONTRACT_PRINT_QUANTITY_ALLOCATED`, `EVENT_NOT_ENDED`, `EXPENSE_REVISION_STALE`,
`INVOICE_FINALIZED`, `INVOICE_REVISION_STALE`, `INVOICE_FINALIZATION_REQUIRED`,
`STALE_BILLING_REVISION`, `PAYMENT_ATTEMPT_ACTIVE`, `FINANCIAL_SOURCE_CONFLICT`.
Strict schema failures use 422; authorization uses 401/403/404; business conflicts
use 409. See generated [OpenAPI](../openapi/openapi.json) for exact schemas.

This work does not implement seating, Guest attendance, print-file rendering,
tax/e-invoice integrations, workers, automatic VNPay refunds or live sandbox
balance acceptance. The later RV tasks retain those separate checkpoints.
