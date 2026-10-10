# Backend Revision Tasks: 2026-10-10

Business scope confirmed by the owner. Implementation below is pending unless
checked with evidence. This is the active backlog for the commercial/profile
extensions and SPEC-06 onward; supersedes older mixed backend/frontend outlines.
Sources: [confirmed scope](../docs/backend-scope-2026-10-10.md),
[commercial specification](../SPEC-commercial-contracts.md),
[Guest specification](../SPEC-guest-management.md), and
[SPEC-01–05 runtime/provider audit](./evidence/spec01-05-runtime-audit-2026-10-10.md).

## Completed Scope Preparation

- [x] Interview and record removal of guest response behavior while retaining guests/seating/check-in.
- [x] Confirm service units/quantities, frozen prices, 30% total contract deposit, Manager final invoice and mutual appendices.
- [x] Confirm on-system dual contract approval/PDF and distinct bride/groom fields.
- [x] Separate backend tasks from frontend delivery; preserve prior acceptance history and frontend source.
- [x] Publish revised product/specification/ownership documents; retire the former UI skill and installer.
- [x] Verify the mapped guest-plan terminology cleanup: 49 unit/contract + 3 PostgreSQL tests, typecheck/lint/build/API/format checks; [evidence](./evidence/backend-scope-2026-10-10.md).

## SPEC-01-05 Runtime and Provider Follow-ups

Added after the owner's 2026-10-10 request. Historical SPEC-01–05 implementation
acceptance is preserved; it does not mean live external integrations or every
operational follow-up has passed. All RV tasks below are unchecked. Current audit
findings are in the linked report, not new test/deployment evidence.

Use four separate evidence fields: implemented code, offline tests, configuration,
and live/runtime verification. Adapter code executed with a controlled transport is
offline proof. Configuration presence or a bucket/sender/health read is not feature
acceptance. "No evidence found" means pending verification, not proof of a defect.

Each task is backend-owned. Backend gate closure uses authorized HTTP/provider and
operator evidence, not rewriting client UI or running frontend quality suites. Where
browser cookie or printed output behaviour crosses ownership, record the narrow
joint verification and frontend hand-off separately. Keep tokens, OTPs, signed URLs,
IPN secrets and real-person data out of committed evidence. Live tests need an
authorized disposable/staging environment and bounded cost; CI remains offline.

| Task | Owner / dependency | Acceptance | Verification / evidence |
| --- | --- | --- | --- |
| RV-01 Runtime feature manifest | Core + owners; audit | Classify each integration as configured/unconfigured, offline/live verified, missing implementation or downstream dependency. Verify absent providers cannot masquerade as live successes; document development fake fallbacks. | Secret-safe startup/config tests; exact commit, environment and feature matrix; never print credential values. |
| RV-02 Database-backed readiness | Core; RV-01 | Wire a bounded real database readiness probe into the deployed composition; liveness remains independent. Confirm safe TLS/connection mode, schema compatibility and resource shutdown. | Local focused health/lifecycle tests; approved staging query, controlled DB outage -> ready 503/live 200, recovery and graceful restart. Health 200 alone is insufficient. |
| RV-03 Operator Manager bootstrap | Identity; RV-01/02 | Supply the operator-only CLI around the existing bootstrap service. Hidden prompt/approved descriptor, explicit target/operator, one transaction/audit, refusal when a Manager exists; never use demo passwords/seed as production bootstrap. | Disposable database first/repeated/concurrent bootstrap and failure tests; redacted operator rehearsal. No password in argv, logs or committed files. |
| RV-04 Live identity email | Identity + Booking; RV-02/03 | Through the selected configured Brevo OR Resend provider, receive a real workspace invitation and current password OTP at an authorized test mailbox; verify acceptance/reset/change and reissue/expiry/denials. Align active docs with OTP routes; retired reset-link routes are not a success path. | Recorded HTTP workflow, redacted provider acceptance/delivery and recipient receipt; identity transition/audit evidence. Sender read or mocked fetch is insufficient. No need to enable both providers. |
| RV-05 Deployed auth transport | Identity + deployment; RV-03/04 | Verify configured proxy/origins and same-site/proxy arrangement, secure refresh cookies, refresh rotation/logout/revocation and OTP key stability across restart. No cross-account access. | Deployed backend HTTP cookie-jar/header/denial tests on actual proxied hosts. Frontend owns browser round-trip verification, recorded separately for release; backend tests do not claim browser/native acceptance. |
| RV-06 Retention operations | Identity + Booking; RV-02 | Establish an authorized operator schedule/runbook for identity and consultation retention; due/holds/reference rules, bounded batches and repeat-safe recovery. Do not infer execution from a tested CLI. | Disposable populated rehearsal with current retention scripts; target checks, counts/audit, ownership and schedule/manual procedure. Never execute destructive tests on shared customer data. |
| RV-07 Live catalog Storage | Venue + Core; RV-02/03 | Use real configured private Supabase Storage via catalog APIs: upload/attach/list/refresh/read, validate metadata/checksum and backend denial; retain published references and clean only owned test objects. | Authorized staging object round-trip, expiring signed read and draft/private-resource denial; approved public/current media remains readable without exposing keys. Provider receipt plus API/database evidence, not bucket existence. |
| RV-08 Live wedding media Storage | Invitation; RV-07 + confirmed test booking | Real upload/download/replace/detach under post-deposit access, quota/cutoff/history rules; interrupted-upload recovery cannot lose retained snapshots. No private original leaks. | Staging HTTP/Storage round-trip; real decoder checks and controlled crash/retry tests using existing media journal; exact retained revision and cleanup scope. Demo data alone is insufficient. |
| RV-09 Public invitation and generic QR | Invitation + deployment; RV-08 | Configure stable PUBLIC_INVITATION_ORIGIN; publish/view HTML/JSON/assets on actual routed origin, scan generic QR, unpublish -> concealed 404. No private library, personalized credential, guest response or check-in authority. | Backend deployed public reads and asset access tests; QR decoding/authorized scan and redacted publication identity. Confirm retention/access policy of derived assets separately from private originals. |
| RV-10 Live Gemini generation | Invitation + Core; RV-08 | Configure selected image model/key; post-deposit prompt -> real Gemini image -> fully validated private Storage asset -> usable design revision. No private wedding photo sent to AI. | Explicitly authorized bounded paid/provider smoke run; redacted request correlation, model/result metadata and persisted asset evidence. Mock image tests do not close this task. |
| RV-11 AI unknown-effect recovery | Invitation; RV-10 | Verify durable generation/reconciliation on interrupted response or failed Storage acceptance; retry the same intent without another unapproved paid generation. Manager recovery remains auditable. | Controlled fault tests against real application services plus a staged operator recovery rehearsal; call-count/intent/storage proof without deliberately buying duplicate generations. |
| RV-12 VNPay sandbox setup | Payments + deployment; RV-02/03 | Obtain sandbox merchant configuration; validate checkout signing/settings, actual return routing and public server IPN endpoint; prove missing/invalid config fails closed. Current sandbox-only URLs stay explicit. | Config/protocol tests plus authorized provider/merchant callback configuration record; no secret values. A reachable return page is not settled money. |
| RV-13 VNPay sandbox deposit | Payments + Booking + Identity; RV-12 | Perform provider-hosted sandbox checkout and genuine IPN/status verification; settle once, confirm slot and promote the same identity. Reject invalid amount/signature/correlation; timeout/unknown cannot falsely confirm. | Real sandbox transaction and redacted receipt + attempt/ledger/Booking/access evidence; controlled duplicate/late/invalid tests. Rerun against full-contract amount after BE-09. No test-seed settlement as live evidence. |
| RV-14 VNPay balance checkout | Payments; RV-13; BE-15/16 for revised invoice | Verify provider-hosted sandbox BALANCE settlement, amount/version pinning, pending/unknown reconciliation and once-only ledger totals. Test the existing balance model now; revised final-invoice behaviour requires BE-15/16 then a fresh run. | Actual sandbox balance receipt and API/ledger proof; controlled stale/duplicate/timeout cases. No automatic VNPay refunds or production-money claim. |
| RV-15 Deployed Booking/Billing lifecycle | Booking + Payments; RV-04/13 | On authorized staging data prove consultation -> approvals -> deposit -> same-identity access, conflicting slot/revision denial and supported change/cancellation/manual-accounting flows with current owners. Preserve approved monetary history. | Backend multi-actor API journey, audit/ledger consistency and recovery proof. After BE-07/09/11/15/16 rerun the revised contract-to-final-invoice journey; no direct DB seeding of success or fictional cash refund. |
| RV-16 Actual workers and recovery | Core + owners + Notifications; NTF-W1/3/4 | Wire and operate the agreed outbox/retry/due-command and recovery consumers; prove media cutoff, D-3 and +12h completion/reconciliation run without UI polling. Ports/outbox rows alone are not automatic execution. | Worker start/stop/lease/retry/dedup/late-command evidence on approved staging fixtures; current source revision and operational owner. Until SPEC-09 exists, label downstream pending; no guest-response jobs. |
| RV-17 Print-file output contract | Invitation; approved SPEC-05 Section 11 | Agree exact printable revision, file format, physical dimensions/front-back, Vietnamese fonts, image quality, QR bounds, access and error contract. Keep contract PDF (BE-08) separate. | Owner-reviewed backend renderer/download contract and sample acceptance criteria; no proposed route published as implemented. Format decisions remain explicit, not guessed. |
| RV-18 Print files without seating | Invitation; RV-17/08/09 + approved print snapshot | Implement authorized exact-version preview/render/download of restaurant print files; use retained immutable content/assets, not current mutable design. No duplicate charge; verify contracted print linkage after BE-12. | Focused renderer/API tests and actual generated-file inspection/QR decoding after later design edits; download authorization, digest and bounded output. Snapshot JSON or public HTML is not a print file. |
| RV-19 Print files with seating | Invitation + Seating; RV-18 + SEA-W3/5 | Render real accepted SPEC-07 fixed-layout/group snapshot; preserve printed history and reject stale/ineligible confirmation at print boundary. No person-seat or geometry editing. | Real owner integration and generated-file geometry/glyph/QR inspection; range/retirement/headcount/print races. Registry doubles cannot satisfy the Seating dependency. |
| RV-20 Operational observability | Core + deployment; RV-02 | Verify real request/error/audit correlation and secret-safe logs on target runtime. If metrics/OTLP are selected, verify protected scrape/collector ingestion and operational visibility; otherwise record optional disabled status. | Authorized deployed request/failure and redacted logs; unauthorized metrics denial, real scrape/collector evidence only when enabled. No mandatory new paid monitoring vendor. |
| RV-21 Runtime hand-off checkpoint | Integration steward; relevant RV tasks + BE-17/REL-W3 for revised release | Publish exact commit/API digest, tested target, provider mode/model, enabled-feature list, evidence and unresolved gates. Disabled required features cannot be claimed complete. Production-money VNPay needs separate owner-approved scope/adapter/merchant review. | Owner-reviewed feature/evidence manifest feeding REL-W4/5; backend verification gates and release recovery proof. Attach FE/native integration dependencies separately; do not mark them as completed backend tests. |

- [ ] RV-01
- [ ] RV-02
- [ ] RV-03
- [ ] RV-04
- [ ] RV-05
- [ ] RV-06
- [ ] RV-07
- [ ] RV-08
- [ ] RV-09
- [ ] RV-10
- [ ] RV-11
- [ ] RV-12
- [ ] RV-13
- [ ] RV-14
- [ ] RV-15
- [ ] RV-16
- [ ] RV-17
- [ ] RV-18
- [ ] RV-19
- [ ] RV-20
- [ ] RV-21

Checkpoints: RV-01–03 establish a safe environment/operator boundary; RV-04–11
close selected email/auth/Storage/AI/public-link proof; RV-12–15 close sandbox
money/access proof; RV-16–20 close agreed operations/output gates; RV-21 records
the complete enabled-feature manifest. Split implementations into small owner-local
slices; task dependency lists do not waive configuration or cost approval.

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
