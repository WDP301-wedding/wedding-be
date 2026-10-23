# Confirmed Backend Scope: 2026-10-10

Status: business scope confirmed by the project owner on 2026-10-10 after seven
interview questions and the final response "đúng với ý tôi r". This confirmation
approves requirements, not implementation or test evidence.
Active specification baseline: `WEDDING-CONTRACT-3@3.0.0`; the Group + optional
Guest amendment below was confirmed by the owner on 2026-10-10. Previous baseline
`WEDDING-CONTRACT-1@1.1.0` remains the implemented compatibility baseline until
each extension has its real-provider and OpenAPI hand-off.

This document supersedes conflicting product/specification/task text, including
copied historical sources in the former SPEC-05/06 guide. SPEC-01 through SPEC-04
are completed according to the owner; SPEC-05 backend is completed. Preserve
evidence and frontend source. New requirements are extensions to completed work.

## 1. Team Boundary

Pre-deposit mobile amendment confirmed by the owner on **2026-10-23**: Couple may
use Android before paying the deposit, including existing profile, proposal,
commercial contract, timeline and deposit workflows. Invitation acceptance grants
the account role `COUPLE` with consultation access still `RESTRICTED`; existing
workspace owners receive the role through a forward data migration. Android lists
the same owned bookings as Web, including pre-deposit and terminal phases. `COUPLE`
is no longer evidence of payment. Only verified deposit settlement promotes an
owned consultation to `FULL`; media, invitations, guests, seating and production
retain their post-deposit guards. The owner subsequently authorized deployment of
this backend and its migration to the existing server on 2026-10-23, subject to the
normal exact-head release gates. Frontend changes remain outside this request. See
[API, migration and app hand-off](./couple-predeposit-app-access.md).

Payment recovery amendment approved by the owner on **2026-10-19**: implement the
frontend's payment-attempt reopen/expiry request. An authenticated VNPay missing-order
or unpaid response may close an unresolved attempt only after `expiresAt + 15 minutes`;
expiry alone, unavailable queries and unverified responses still retain UNKNOWN.
This supersedes the earlier missing-order rule in ADR-006 for this narrow condition.
Use the existing atomic verified-failure release and settlement safeguards. See
[the implementation hand-off](./payment-attempt-reopen-and-expiry.md).

Website remediation amendment confirmed by the owner on **2026-10-19**: for the
performance/reliability initiative, changes may cover all of `wedding-web` plus
supporting `wedding-be` code. Required sequence is frontend -> backend -> direct
deployed browser E2E. This is a scoped exception to the backend-only restriction
below, not a transfer of `wedding-manage-web` or `wedding-app` ownership. The
[scope amendment](./web-remediation-scope-2026-10-19.md) links the canonical plan
and task status. Historical SPEC/RV evidence and all business rules remain valid.

Backend merge-policy amendment confirmed by the owner on **2026-10-13**:
`wedding-be` no longer requires approval from another team member before merge.
The owner may authorize merge and deployment after change review, resolved
conversations and passing exact-head CI. Required quality, migration, coverage,
dependency-audit and provider-evidence gates remain unchanged. This is a backend
policy change, not an amendment to frontend repository policies or historical
review/acceptance evidence.

SPEC-11 recovery amendment confirmed by the owner on **2026-10-13**: the current
dedicated Railway staging/demo contains synthetic test data only. Recovery may
rebuild a new database from the immutable migrations and deterministic native seed;
there is no 30-day backup-retention requirement for this demo. Accept loss of
transient test accounts, sessions, fixtures and provider sandbox state. Never use
this exception for real customer/contract/payment data or production. Existing
backup/restore/erasure rehearsal evidence remains preserved; selecting rebuild
does not authorize deleting retained business history or resetting a shared DB.
Recovery owner stays Lê Bá Bách. Live Android FCM test/acceptance is separately
deferred to the app team's integration phase; backend preparation remains required.

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

The owner chose Group + optional Guest list on 2026-10-10. Remove the Household/
invitation-party identity model from new work; do not merely rename
a party record to Guest. A Guest represents one named person and belongs to one
stable Group. Contact data and operational notes are optional. Default/custom
groups, colors and group table labels remain usable with no named guests at all.
Duplicate names remain separate Guest IDs; do not infer families or merge by name.

The owner clarified that a named Guest may bring other people. Removing Household
does not prohibit companions. Recording planned/actual companion quantities was
subsequently proposed but has not been confirmed. Settle that narrow requirement
before implementing companion-dependent Guest/check-in schemas and counts; the
named Guest identity/count is not the number of all people arriving with that Guest.

SPEC-08 execution clarification, confirmed by the owner on 2026-10-12: implement
only check-in of named Guests in this revision; companion quantities are deferred
to separate requirements. This authorizes the named-only Staff implementation and
does not prohibit accompanying people or confirm any companion counting rules.

Couple/Manager may supply no names, some names or a full list. No list is required
for contract/deposit, media, generic invitation/QR, printing, layout confirmation,
event completion or final invoice. Imports and personalized read-only invitations
are optional named-Guest workflows; generic sharing works without a Guest record.
A guest link grants only a minimal invitation view, never a guest list, contact data,
notes, billing or attendance write. Generic QR remains public and cannot authorize
check-in. Automated personalized delivery needs an explicit authorized recipient;
absence of recipient/contact data does not block the wedding.

Planned attendance is a separately entered integer total from Couple/Manager, not
Guest count, a sum of companion quantities or table capacity. Initial Guest workspace
access preserves the existing Booking planning total; an empty/partial list, import,
Guest archive or group display edit cannot reset or recalculate it. Explicit count
changes create immutable booking-wide plan revisions and monotonic sourceSequence,
atomically synchronize Booking and revalidate seating. Zero is only an explicit
planning value; layout confirmation still requires a positive compatible count.

Name-based check-in is opt-in per booking: checkInMode NONE (default) or BY_GUEST_NAME.
Owning FULL Couple/Manager explicitly enable it with at least one active named Guest;
adding/importing a Guest never enables it. Authorized assigned Staff check in one
listed person once, with append-only corrections/undo and duplicate/retry protection.
No Household identity or mandatory unlisted walk-in counter is added. Companion
recording rules remain open as noted above. Staff may
still perform other assigned duties when check-in is off. After the first check-in
record, mode history cannot be switched to NONE to erase or hide attendance evidence.

When check-in is NONE, actual attendance is not recorded/unknown (nullable), not 0.
When enabled, checkedInGuestCount is only the measured named-list count; a partial
list must never be reported as whole-event attendance or used as its rate denominator.
Reports keep planningHeadcount, listedGuestCount and checkedInGuestCount distinct.
Billing always uses contract/appendix/expense facts, never check-in totals. Viewing
an invitation changes none of these counts and gives no attendance-write authority.

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

Initial-proposal extension requested by the owner on **2026-10-18**: Manager may
select multiple menu versions with a separate table quantity for each when creating
the first Booking proposal. Preserve legacy one-menu input and historical snapshots;
calculate aggregate tables/prices on the server. This does not change Couple/Manager
contract approval, actual deposit authority, or post-deposit appendix rules. See
[API and migration hand-off](./booking-multi-menu-proposals.md).

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

| Owner            | Extension                                                                     | Consumers                                                      |
| ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Venue            | Service/print price offerings, exact facts and eligibility                    | Booking                                                        |
| Booking          | Names, multi-menu selections, contracts/appendices, deposit eligibility       | Payments, Invitation, Notifications, Analytics                 |
| Payments         | Once-only agreed charges/deltas, expenses, final invoice and adjustments      | Notifications, Analytics                                       |
| Invitation       | Safe template selection facts; contract-linked print fulfillment              | Booking, Guest                                                 |
| Guest Management | Groups, optional named Guests/read-only links and explicit planning total     | Booking synchronizer, Seating, Staff, Notifications, Analytics |
| Staff Operations | Optional per-booking check-in mode, assigned one-person check-in/undo history | Analytics                                                      |

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
