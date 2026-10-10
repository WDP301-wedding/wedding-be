# Backend Revision Tasks: 2026-10-10

Business scope confirmed by the owner. Implementation below is pending unless
checked with evidence. This is the active backlog for the commercial/profile
extensions and SPEC-06 onward; supersedes older mixed backend/frontend outlines.
Sources: [confirmed scope](../docs/backend-scope-2026-10-10.md),
[commercial specification](../SPEC-commercial-contracts.md),
[Guest specification](../SPEC-guest-management.md).

## Completed Scope Preparation

- [x] Interview and record removal of guest response behavior while retaining guests/seating/check-in.
- [x] Confirm service units/quantities, frozen prices, 30% total contract deposit, Manager final invoice and mutual appendices.
- [x] Confirm on-system dual contract approval/PDF and distinct bride/groom fields.
- [x] Separate backend tasks from frontend delivery; preserve prior acceptance history and frontend source.
- [x] Publish revised product/specification/ownership documents; retire the former UI skill and installer.
- [x] Verify the mapped guest-plan terminology cleanup: 49 unit/contract + 3 PostgreSQL tests, typecheck/lint/build/API/format checks; [evidence](./evidence/backend-scope-2026-10-10.md).

## Extensions to Completed SPEC-02–05

Each task is backend-only, uses existing owner directories and normally changes
at most five human-authored files. Split schema, adapters, HTTP and publication when
needed; a dependency is not satisfied by documentation or a conforming fake alone.

| Task | Dependency | Acceptance | Verification |
| --- | --- | --- | --- |
| BE-01 Profile schema/DTO | Scope | Nullable bride/groom fields in intake/consultation; retained legacy label; normalized names; no guessed backfill | Schema/validation tests; empty/upgrade migration |
| BE-02 Profile commands/readers | BE-01 | Authorized own/Manager writes with revision/audit; conversions preserve names; no cross-booking disclosure | Focused service/HTTP tests; disposable persistence proof |
| BE-03 Service catalog persistence | Scope | Versioned stable ID/name/description/unit/price/active status; referenced archive preserved | Unit validation; migration/history tests |
| BE-04 Service catalog API/provider | BE-03 | Manager CRUD/price/archive; active selection + historical reader | RBAC, stale price, snapshot/archive tests |
| BE-05 Print commercial offerings | Scope | Venue price/type/quantity facts + safe Invitation template selection port; no media/editor before deposit | Reader conformance, schema/HTTP/access tests |
| BE-06 Multi-menu contract schema | BE-02/04/05 | Immutable commercial revisions/lines; multiple menu table quantities; names/venue/timeline snapshots | Checked arithmetic/capacity tests; serialized migration proof |
| BE-07 Contract submit/approvals | BE-06 | Exact Manager/Couple approvals; material edits/withdrawals reset eligibility; no inherited approvals | Stale/duplicate/cross-scope/price/approval races |
| BE-08 Contract PDF | BE-07 | Private exact-version PDF; full lines, names/total and required Vietnamese clause | Authorization, digest and rendered Vietnamese PDF proof |
| BE-09 Deposit integration | BE-07 | ceil(30% full contract); both timeline/contract revisions pinned; legacy settlements preserved | Existing payment regressions; real reserve/edit/settle/unknown races |
| BE-10 Contract receivable registration | BE-09 | One agreed obligation; unique source revision; no duplicate legacy base/print charge | Ledger conformance; real rollback/replay/money proof |
| BE-11 Appendix revisions/approval | BE-07/10 | Reason/predecessor/before-after/signed delta, mutual approval, nonnegative effective total | Stale predecessor, concurrent approvals; persistence proof |
| BE-12 Contract-linked print | BE-05/10/11 | Contract-included print fulfillment billed once; changes use approved appendix delta | Print/Billing real conformance; quantity/price/cancellation cases |
| BE-13 Expense schema/policy | BE-10 | Post-event Manager-only draft name/unit/qty/price/note and server total | Event-end boundary, integer/overflow and migration tests |
| BE-14 Expense draft HTTP | BE-13 | Authorized create/update/delete with idempotency/revision/audit; finalized lines locked | HTTP RBAC/stale/retry + persistence tests |
| BE-15 Final invoice | BE-11/12/14 | Contract + approved deltas + expenses; Manager finalize; no Couple approval; zero-expense support; atomic posting | Real concurrent finalize/replay/rollback; exact ledger totals |
| BE-16 Adjustments/balance | BE-15 | Immutable reasoned credit/debit/new invoice; net settled/refunded money; credit visible; unknown payment pinning | Adjustment/payment races; no duplicate charge/refund |
| BE-17 Extension hand-off | BE-02 through BE-16 | Mounted real runtime, exact OpenAPI/provider versions, migration/evidence matrix, examples/errors | Backend lint/typecheck/test/build/coverage/integration/contract/API checks |

- [ ] BE-01
- [ ] BE-02
- [ ] BE-03
- [ ] BE-04
- [ ] BE-05
- [ ] BE-06
- [ ] BE-07
- [ ] BE-08
- [ ] BE-09
- [ ] BE-10
- [ ] BE-11
- [ ] BE-12
- [ ] BE-13
- [ ] BE-14
- [ ] BE-15
- [ ] BE-16
- [ ] BE-17

## SPEC-06–11 — Backend Only

Every task in this section, including SPEC-06, is backend-only. No frontend task,
client generation, browser screenshot or native build is included in these backend
checkboxes. API examples and hand-off documents are delivered to the frontend team;
the frontend team owns its implementation separately.

### SPEC-06 — Guest Management

Safe isolated work may start against accepted owner contracts; integrated acceptance
requires actual publication, access and ordered headcount providers.

- [ ] GM-W1: Implement groups/households/import, checked planned totals and durable revisions; verify atomic imports, legacy history and normalization.
- [ ] GM-W2: Implement read-only personalized credentials/exchange/view/reissue; verify privacy, scope, hash-only storage, rate limits and expiry; no guest attendance writes.
- [ ] GM-W3: Implement ordered Booking headcount sync, Staff search and reporting/delivery ports; verify stale/replay/rollback and minimum-data conformance.
- [ ] GM-W4: Mount strict HTTP/Zod/OpenAPI; verify actual routes/denials/errors and publish examples/digest for frontend.
- [ ] GM-W5: Verify real headcount -> Seating -> print invalidation plus migrations, concurrency and requirement evidence; automated sending needs real Notifications adapter.

### SPEC-07–11 — Backend Only

- [ ] SEA-W1: Compatibility/remapping rules and pure capacity tests.
- [ ] SEA-W2: Immutable plan persistence and migration/revision proof.
- [ ] SEA-W3: Confirmation/exception/print registry/Staff guidance with real owner conformance and rollback/race tests.
- [ ] SEA-W4: HTTP/OpenAPI and authorization; no geometry/person-seat writes.
- [ ] SEA-W5: Backend acceptance evidence and frontend hand-off.
- [ ] STF-W1: Staff provisioning/assignments and authorization.
- [ ] STF-W2: Append-only multi-arrival/correction ledger with real concurrent tests.
- [ ] STF-W3: Guest search/Seating guidance/reporting providers; expected counts remain separate from actual arrivals.
- [ ] STF-W4: HTTP/OpenAPI and assigned-scope denial/retry proof.
- [ ] STF-W5: Backend acceptance evidence and frontend hand-off.
- [ ] NTF-W1: Durable intents/recipient/device/channel registry and migration proof.
- [ ] NTF-W2: Credential delivery, encryption and safe template/provider handling.
- [ ] NTF-W3: Contract/appendix/payment/invoice/print and guest-plan handlers; no response events/deadline jobs.
- [ ] NTF-W4: Due scheduler/reconciliation, media/D-3/completion jobs, retry/unknown/dedup proof.
- [ ] NTF-W5: Settings/inbox/operations HTTP, outbox/provider integration evidence and frontend hand-off.
- [ ] ANL-W1: Source formulas include agreed services/appendices/expenses/final invoices; no guest response metrics.
- [ ] ANL-W2: Projection/checkpoint/rebuild with monotonic source ordering.
- [ ] ANL-W3: Authorized analytics HTTP/OpenAPI and bounded query/freshness proof.
- [ ] ANL-W4: Deterministic fixture/real-source backend acceptance and frontend hand-off.
- [ ] REL-W1: Backend environment/auth/config/manifest validation.
- [ ] REL-W2: Deterministic idempotent backend seeds and API journey including full contract -> deposit -> event -> final invoice.
- [ ] REL-W3: Empty/upgrade migrations, backend staging/runtime health/recovery evidence.
- [ ] REL-W4: Immutable API/provider manifest and frontend release integration checklist; frontend delivery recorded separately.
- [ ] REL-W5: Backend go/no-go evidence and recovery hand-off; full product release waits for frontend integration.

## Verification Record

For each completed task append exact command, result, environment, immutable provider
version/API digest and evidence link to the owning module evidence. A skipped database
test is not migration/integration proof. Do not tick future commercial/guest tasks
merely because this requirements amendment was confirmed.
