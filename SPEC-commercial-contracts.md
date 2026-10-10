# Specification: Commercial Extensions to SPEC-02–05

- Business scope confirmed: 2026-10-10; implementation pending.
- Baseline: `WEDDING-CONTRACT-3@3.0.0`; optional Guest amendment changes no money formulas.
- Authoritative rules: [confirmed scope](./docs/backend-scope-2026-10-10.md).
- Ownership: existing Venue, Booking, Payments and Invitation modules; no new module ID or SPEC number.
- Requirements: CPL-001–003, SVC-001–004, CTR-001–007, FIN-001–006; amended ACC-003/004, TML-005 and PRN-006.
- Execution and acceptance: backend only.

## 1. Objective and Boundaries

Freeze the full agreed wedding price before deposit, preserve both parties' approval,
support reasoned post-deposit appendices and calculate an itemized final invoice after
the event. Extend completed SPEC-02–05 without rewriting their completion evidence.
Leave all client repositories unchanged and publish API/provider hand-offs separately.
Do not silently enable new deposit semantics against partially implemented adapters.

## 2. Persistence and Commands

| Owner      | New durable records                                                                                                               | Key rules                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Venue      | RestaurantService, service revisions; PrintOffering/revisions                                                                     | Stable IDs, Manager-only changes; active selections; historical resolution            |
| Booking    | Nullable intake/consultation brideName/groomName; CommercialContract/Revision/Line/Approval; CommercialAppendix/Revision/Approval | Exact immutable references; snapshot names; dual approval; signed appendix delta      |
| Payments   | Contract/appendix charge source linkage; IncidentalExpenseDraft/Line; FinalInvoiceRevision/Line; InvoiceAdjustment                | Atomic once-only ledger posting, immutable finalized content, append-only corrections |
| Invitation | Print-order line commercial reference                                                                                             | Contract-included fulfillment uses source linkage; no duplicate charge                |

Use existing UUID, Decimal(18,0), UTC, Core UoW/idempotency/audit/outbox conventions.
Public DTO amounts remain checked safe integers. Positive integer quantities and
nonnegative integer unit prices; multiply/sum in checked arithmetic before persistence.
Contract/appendix snapshots retain removed catalog display facts and source versions.
Do not cascade-delete signed monetary history or applied migration evidence.

Contract line categories: MENU, PRINT, SERVICE. Store sourceId/sourceRevisionId,
name, description, unit, quantity, unitPriceVnd and lineTotalVnd. Menu quantity means
tables; PRINT means copies; SERVICE uses its catalog unit. Multiple menu lines must
have valid restaurant/hall eligibility and checked aggregate table/capacity rules.
Resolve current offerings at selection/submission and freeze them on the submitted
revision. A catalog edit during draft submission causes conflict; a later edit after
submission/approval does not alter its price or require silent recalculation.

States: DRAFT, AWAITING_APPROVAL, APPROVED, SUPERSEDED. The approved snapshot is
never edited. Supersession points to a new revision with no inherited approvals;
retains every prior approval. Immutable appendices similarly bind the exact effective
commercial predecessor and activate only after two explicit approvals.

## 3. Provider Boundary

Venue publishes typed selection/historical readers for service/print offering
versions. Selection requires active current eligibility; historical resolve can read
archived referenced versions. Invitation exposes a safe template eligibility reader
that reads its template catalog only, without invoking Booking/Payments. Booking
selects from these facts; no consumer reads another module's tables directly.

Booking publishes a CommercialContractReader returning contractRevisionId,
documentDigest, timelineRevisionId, names, immutable lines, contractTotalVnd and
effective approved appendixRevisionIds/deltas. Access authorization is enforced
before HTTP/operational exposure. An internal financial snapshot reader verifies
current commercial eligibility under booking serialization; it cannot infer agreement
from a display label, client total or PDF download.

Extend the existing deposit eligibility port with exact approved commercial identity
and total. Payments reserves/settles through the existing Booking ports. Preserve
unknown payment pinning, slot safety, verified settlement and same-identity promotion.
Do not create a second money/access authority or trust notification completion.

Payments' registration accepts unique typed sources CONTRACT, CONTRACT_APPENDIX,
INCIDENTAL_FINALIZATION and INVOICE_ADJUSTMENT, each with exact source revision,
booking and server-owned amount/signed delta. Identical replay returns the prior
result; changed reuse conflicts. Deposit is a payment reducing outstanding, never
another receivable charge. Contract base charge and its print/service lines are
one obligation, not three duplicate obligations layered on legacy BASE/PRINT sources.

For legacy bookings retain original BASE/PRINT/settlement facts; introduce explicit
commercial model/version discrimination. Real integration tests prove no historical
charge is registered twice when new readers are added. Unconfirmed legacy drafts
require deliberate conversion, re-selection where needed and real approvals.

## 4. Access and Proposed HTTP

These are proposed paths, not implemented OpenAPI claims. Prefix uses existing
/api/v1 mounting. All writes use Idempotency-Key, expectedRevision, current actor
authority, concealed cross-booking identity and atomic audit.

| Method/path                                                         | Actor and purpose                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| GET/POST /management/services                                       | Manager catalog list/create                               |
| PATCH /management/services/{id}                                     | Manager edit/price/archive                                |
| GET/POST /management/print-offerings                                | Manager commercial print catalog                          |
| PATCH /management/print-offerings/{id}                              | Manager edit/price/archive                                |
| GET /catalog/services                                               | Authorized prospect/Couple/Manager active selection facts |
| GET /catalog/print-offerings                                        | Authorized commercial selection; safe template facts      |
| PATCH /consultations/{id}/couple-profile                            | Own prospect/Couple or Manager fills names                |
| GET/POST /bookings/{id}/contracts                                   | Own actor reads; authorized contract draft creation       |
| POST /bookings/{id}/contracts/{revisionId}/submissions              | Submit exact validated lines/timeline/names               |
| POST /bookings/{id}/contracts/{revisionId}/approvals                | Current Manager/Couple approves its own party role        |
| POST /bookings/{id}/contracts/{revisionId}/withdrawals              | Pre-deposit own approval withdrawal; reject payment pin   |
| GET /bookings/{id}/contracts/{revisionId}/pdf                       | Private exact-version download, no public credential      |
| GET/POST /bookings/{id}/contract-appendices                         | Read/create reasoned changes after deposit                |
| POST /bookings/{id}/contract-appendices/{revisionId}/approvals      | Mutual approval on exact predecessor                      |
| GET/POST /management/bookings/{id}/incidental-expenses              | Manager post-event draft list/create                      |
| PATCH/DELETE /management/bookings/{id}/incidental-expenses/{lineId} | Manager draft-only update/remove                          |
| POST /management/bookings/{id}/final-invoices                       | Manager finalizes one exact draft/commercial state        |
| GET /bookings/{id}/final-invoices/{invoiceRevisionId}               | Own Couple/Manager itemized read                          |
| POST /management/bookings/{id}/invoice-adjustments                  | Manager reasoned immutable correction                     |

Names may be missing at intake, but cannot be missing on submission/approval. Prospects
may select commercial print facts but cannot call media/editor/send/production routes.
Staff cannot manage catalogs, commercial approvals, expenses, adjustments or billing.
Couple cannot approve as Manager or provide manager price/totals as authority.

Failures: COUPLE_NAMES_INCOMPLETE, OFFERING_NOT_SELECTABLE,
COMMERCIAL_PRICE_REVISION_STALE, CONTRACT_REVISION_STALE, CONTRACT_APPROVAL_REQUIRED,
COMMERCIAL_PREDECESSOR_STALE, EVENT_NOT_ENDED, INVOICE_FINALIZED,
INVOICE_REVISION_STALE, FINANCIAL_SOURCE_CONFLICT; retain existing payment unknown,
slot/access and resource-not-found envelopes. Zod rejects unknown authority fields.

## 5. PDF and Money Semantics

Private PDF renders exact contract snapshot, authored Vietnamese names, itemized lines,
total, approval metadata and “Các chi phí phát sinh sẽ được tính sau”. Font/rendering
must support Vietnamese glyphs; frontend styling choices do not govern this artifact.
Use a reviewed existing PDF stack or a narrowly scoped dependency; record digest and
render proof. Never infer a digital signature from a rendered name/timestamp.

Deposit = ceil(total * 30 / 100), checked integer VND. Appendices change effective agreed
price but never rewrite the original deposit payment or collect an automatic new cọc.
Final total = original contract + approved appendix deltas + incidental lines.
Balance = final total - (settled payments - settled refunds); expose outstanding and
credit separately. Do not clamp away an overpayment or infer a refund completed.

Incidental drafts open at authoritative event end, not the +12h completion worker.
Manager finalization works with zero incidental lines. Serialize snapshot, new ledger
sources and invoice activation in one shared UoW. Failure rolls back all activation.
Concurrent finalizations with the same source replay; changed revisions conflict.
Final adjustments create new reasons/facts/revisions; an unresolved balance intent
blocks a conflicting amount revision until verified reconciliation.

## 6. Backend Slices and Verification

See tasks/backend-revision-todo.md for executable scope. Order: profile and catalogs,
contract snapshots/approvals, exact deposit/PDF, appendices/contracted print charging,
incidental drafts/final invoices and correction/payment reconciliation. Keep each task
bounded by owner; shared migrations, package and OpenAPI edits are serialized.

Meaningful tests prove missing/legacy names, multi-menu arithmetic/eligibility,
price/approval races, snapshot immutability after archive, cross-booking denials,
timeline/contract supersession versus reserved/settled deposits, print fulfillment
without duplicate receivables, signed appendix deltas, event-time expense gate,
zero-expense finalization, unknown balance pinning, net-paid refunds/overpayment,
concurrent finalization/adjustment and real PostgreSQL rollback/upgrade behavior.
Run existing typecheck/lint/test/build/contract/API checks and relevant migration/
integration/coverage suites. Spec examples are not conformance or runtime evidence.
Do not mark a task done until implemented, wired and verified at its applicable gate.
