# Confirmed Backend Scope: 2026-10-10

Status: business scope confirmed by the project owner on 2026-10-10 after seven
interview questions and the final response "đúng với ý tôi r". This confirmation
approves requirements, not implementation or test evidence.
Active specification baseline: `WEDDING-CONTRACT-2@2.0.0`; previous baseline
`WEDDING-CONTRACT-1@1.1.0` remains the implemented compatibility baseline until
each extension has its real-provider and OpenAPI hand-off.

This document supersedes conflicting product/specification/task text, including
copied historical sources in the former SPEC-05/06 guide. SPEC-01 through SPEC-04
are completed according to the owner; SPEC-05 backend is completed. Preserve
evidence and frontend source. New requirements are extensions to completed work.

## 1. Team Boundary

From SPEC-06 onward, executable tasks change only `wedding-be`. The frontend team
owns client implementations and their UI redesign. Keep sibling repositories intact.
Remove the former mandatory design skill, local installation and installer.
Backend acceptance requires provider tests, authorization, migrations, money/race
proof and exact OpenAPI artifacts. Client generation/build, browser screenshots,
typography tests and Android builds belong to the frontend team's separate backlog.
A full product release still depends on frontend delivery; backend hand-off alone
does not constitute a completed four-repository release.

## 2. Guests and Invitations

Remove RSVP completely from active behavior and future work: no response statuses,
response counts/history, mutations, deadlines, reminder jobs or related events/metrics.
SPEC-06 becomes `guest-management`; this explicit owner-approved rename replaces
the old `guest-rsvp` ID wherever active. Old migration/evidence history is retained.

Keep invitation households, default/custom groups, imports, personalized read-only
invitations, delivery, expected counts, group seating and multi-arrival check-in.
A guest link grants only a minimal invitation view, never a guest list, contact data,
notes, billing or attendance write. Generic QR remains public and cannot authorize
check-in. Staff records actual arrivals independently.

Planned attendance = sum of `expectedAttendees` for active households, entered by
authorized Couple/Manager actors. Empty list = zero; archival removes contribution
but preserves history. Immutable booking-wide guest-plan revisions and monotonic
sourceSequence synchronize headcount and invalidate seating when necessary.
No guest interaction changes planned or actual attendance.

## 3. Bride and Groom Profile

Add separate `brideName` and `groomName` to booking-owned consultations/intake
and API contracts. Names are trimmed NFC text, 1–120 characters when supplied;
both are required before commercial contract approval. Initial intake can omit
names so leads and existing records remain usable. Account `displayName` remains
an account label, not the couple identity.

Legacy records retain their display label and initially nullable names. Never parse
"An và Minh" or guess roles; authorized actors complete missing names. Snapshot
both names into contracts/appendices/PDFs; profile edits cannot rewrite approved
documents. Post-deposit invitation text can initialize from this profile; design
text editing does not change contract identity.

## 4. Restaurant Services and Print Offerings

Venue owns Manager-controlled add-on services: name, description, unit,
integer unitPriceVnd, revision and active/archive status. MC can be per session,
music per performance, lion dance per session. Quantity is a positive integer.
Managers create/edit/archive services and prices. Referenced records are not
physically deleted. New selections require active services; contracts freeze
source/version, name, unit, quantity, price and checked server-calculated total.

Venue also supplies minimal commercial print offerings: template/style reference,
print type/material, unit price, revision and eligibility. Invitation Studio owns
templates and production content. Resolve template eligibility through a published
selection port, without exposing private drafts. Before deposit Couple selects only
template/type/quantity for pricing. Media, full editing, sending and production
remain post-deposit.

## 5. Commercial Contract and Deposit

Booking owns the commercial contract alongside the timeline lifecycle. A contract
contains separate bride/groom names, venue/date/shift, exact timeline revision
and immutable item lines:

- One or more menu combo versions, table quantities and per-table prices.
- Invitation template/type versions, copy quantities and per-copy prices.
- Service versions, units, quantities and unit prices.

Each line stores category, source/version, name, unit, quantity, unitPriceVnd and
computed lineTotalVnd. Client totals are never authoritative. Draft submission
resolves exact active catalog prices; changed revisions return a conflict requiring
explicit re-selection. Approved contracts never reprice against the current catalog.
Validate restaurant ownership and total table/capacity rules via Venue. No line
assigns an individual guest to a table.

States: `DRAFT -> AWAITING_APPROVAL -> APPROVED`. Material edits create successors
with no inherited approvals. Manager and owning Couple approve the same revision;
store actor, role, UTC timestamp and document digest. The PDF includes every line,
total and exact clause "Các chi phí phát sinh sẽ được tính sau". Approval is an
authenticated application action. Digital signatures and signed scan uploads are
outside this revision.

Deposit requires both parties' approvals on the current commercial AND timeline
revisions, complete names and valid slot reservation. The contract binds its exact
timeline revision; a pre-deposit timeline change invalidates commercial eligibility.
The owner explicitly reconfirmed hall exclusivity on 2026-10-10: each hall may host
only one couple's confirmed booking for the same local event date and shift
(`hallId + eventDate + shiftCode`). Different halls or different dates/shifts are
separate slots. This preserves the existing SPEC-03 rule, not a new per-hall lifetime
limit. One active hold is allowed per slot; an unresolved/UNKNOWN deposit keeps
its reservation pinned even after hold expiry. Concurrent allocation/confirmation
must not double-book the slot; cancellation/release follows the existing audited
Booking lifecycle rather than silently freeing it on timeout.
Reservation/settlement rechecks both under existing booking serialization and
active/unknown payment locks. Deposit = ceil(contractTotalVnd * 30 / 100), using
checked integer arithmetic. Include menu, thiệp and services, exclude incidental
expenses. Verified settlement remains required for confirmation/access promotion.

Pre-deposit quantity/source/price/material edits reset approvals. No edits while
a deposit attempt is unresolved. Preserve legacy proven amounts/settlement; never
silently convert confirmed bookings or recalculate a paid deposit. Convert an
unconfirmed legacy draft explicitly and obtain real mutual commercial approvals
before new-model deposit eligibility. New behavior activates only after complete
provider/runtime wiring and integration proof.

## 6. Appendices After Deposit

The original contract is immutable. Changes to menu, tables, print or services after
deposit create an appendix with reason, exact predecessor commercial revision,
before/after lines and signed deltaVnd. Both parties approve the same appendix;
only then does it change the effective agreed total. Stale predecessors conflict.
Serialize appendix approval with print price/quantity changes and final invoicing.

Original deposit evidence remains unchanged; appendices do not automatically collect
another deposit. Deltas affect remaining balance; credits/refunds follow Billing.
Effective agreed total cannot be negative. These are agreed changes, separate from
event-time incidental expenses. After invoice finalization use invoice adjustment,
not a new commercial appendix.

## 7. Incidental Expenses and Final Invoice

Payments owns incidental lines and final invoice snapshots. Manager enters expenses
after authoritative event end for a confirmed/completed, non-cancelled booking.
Do not wait for the independent completion job at event end + 12 hours. Staff and
Couple cannot write expenses.

Draft lines have id, name (1–120), quantity (positive integer), unit (1–80),
unitPriceVnd (nonnegative integer), computed total and optional note. Examples:
extra beer, broken glasses or damaged tables. Draft CRUD requires expected revision,
idempotency and audit. Reject overflow, fractional VND and authoritative client totals.

Manager finalizes directly; Couple can read details without approving expenses.
Finalization snapshots original contract, approved appendix deltas and incidental
lines, atomically registers each new receivable once and freezes the invoice.
Booking completion is not proof of invoice closure or payment completion.

```text
finalTotalVnd = originalContractTotalVnd + approvedAppendixDeltaVnd + incidentalTotalVnd
netPaidVnd = settledPaymentsVnd - settledRefundsVnd
balanceVnd = finalTotalVnd - netPaidVnd
outstandingVnd = max(balanceVnd, 0)
creditVnd = max(-balanceVnd, 0)
```

Ledger amounts already registered are referenced, not added twice. Contracted print
quantity is fulfilled after deposit without a second PRINT_ORDER charge. Extra or
reduced quantities/prices require an approved appendix and once-only delta posting.
Legacy print charges remain valid. Do not bill a contract line again via the old
print registrar.

Never overwrite/delete a finalized invoice. Adjustments require a reason, immutable
credit/debit lines, actor/time, predecessor and new invoice revision; audit/ledger
remain append-only. Unique source revisions prevent concurrent duplicate charges.
No automatic VNPay refund. Balance collection uses the applicable final invoice
version; an unresolved payment attempt pins that amount and blocks conflicting
monetary revisions until reconciliation.

## 8. Owners and Build Order

| Owner            | Extension                                                                | Consumers                                                      |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Venue            | Service/print price offerings, exact facts and eligibility               | Booking                                                        |
| Booking          | Names, multi-menu selections, contracts/appendices, deposit eligibility  | Payments, Invitation, Notifications, Analytics                 |
| Payments         | Once-only agreed charges/deltas, expenses, final invoice and adjustments | Notifications, Analytics                                       |
| Invitation       | Safe template selection facts; contract-linked print fulfillment         | Booking, Guest                                                 |
| Guest Management | Groups/households, read-only links, planned headcount                    | Booking synchronizer, Seating, Staff, Notifications, Analytics |

Keep the existing architecture and owner ports. The template selection port reads
catalog facts only; it cannot invoke Billing/Booking writers. Do not introduce a
runtime dependency cycle through Invitation -> Payments -> Booking. Historical
snapshot readers cannot mutate another owner's data.

Order: names/catalog/selection ports -> commercial contract/deposit -> contracted
print/Billing registration -> expenses/final invoice -> SPEC-06 Guest -> SPEC-07
Seating and SPEC-09 Notifications -> SPEC-08 Staff -> SPEC-10 Analytics -> SPEC-11
backend release hand-off. Serialize database migrations and OpenAPI publication.
These are extensions to SPEC-02–05, not renumbered completed specifications.

## 9. Acceptance and Hand-off

Use existing Node/Express/Prisma/Zod/Vitest conventions. Executable backend work is
indexed in tasks/backend-revision-todo.md. Document proposed paths as proposals
until real schemas/runtime exist; do not publish spec-only routes as working APIs.

Required proof: no guest attendance writes; import/headcount ordering; missing names
block approval; several menu combos; inactive offerings denied; catalog edits do not
change contract lines; exact dual approval/PDF clause; stale contract/timeline/deposit
races; 30% total cọc; signed appendix delta; print charged once; event-end expense
gate; Manager-only CRUD; zero-expense invoice; concurrent finalization/replay; immutable
adjustment reasons; net payments/refunds/credits; real ledger consistency.

After code/schema changes run npm run typecheck, npm run lint, npm run test,
npm run build, npm run test:contract, npm run api:generate, npm run api:check,
plus relevant integration/coverage and disposable migration rehearsals. For
documentation/skill removal run changed-file Prettier and git diff --check.

Each backend hand-off includes provider version, migration evidence, schemas,
OpenAPI digest, examples/errors, role matrix, money formulas and private/public
route inventory. Frontend chooses its UI and consumes these contracts separately.
