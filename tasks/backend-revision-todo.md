# Backend Revision Tasks: 2026-10-10

Business scope confirmed by the owner. Implementation below is pending unless
checked with evidence. This is the active backlog for the commercial/profile
extensions and SPEC-06 onward; supersedes older mixed backend/frontend outlines.
Sources: [confirmed scope](../docs/backend-scope-2026-10-10.md),
[commercial specification](../SPEC-commercial-contracts.md),
[Guest specification](../SPEC-guest-management.md), and
[SPEC-01–05 runtime/provider audit](./evidence/spec01-05-runtime-audit-2026-10-10.md).

Owner-confirmed Group + optional Guest amendment: no Household/party model;
Groups/Seating work without names, planning total is separately entered/preserved,
and check-in is explicit per-booking opt-in (NONE by default). A partial named list
is not whole-event attendance. Baseline Section 23 governs these pending tasks;
old checklist/evidence records remain historical. No per-task decision-approval
round is needed for this already confirmed scope.

Companion clarification: a named Guest may bring other people. Planned/actual
companion recording was proposed but not confirmed. Resolve this narrow point before
implementing dependent GM/STF fields/counts; do not infer a ban from Household removal.

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
operational follow-up has passed. The original audit findings remain historical.
RV-01–03 now have separate [target-specific implementation, CI and live evidence](./evidence/rv01-03-runtime-foundation-2026-10-10.md);
other RV tasks remain pending unless checked below.

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

- [x] RV-01
- [x] RV-02
- [x] RV-03
- [ ] RV-04
- [ ] RV-05
- [ ] RV-06
- [ ] RV-07
- [x] RV-08
- [x] RV-09
- [x] RV-10
- Evidence: [2026-10-11 Railway Gemini test](evidence/rv10-gemini-railway-2026-10-11.md)
  records the historical JPEG/PNG failure. The separately authorized live rerun in
  [the current evidence](evidence/rv13-media-ai-runtime-2026-10-11.md) passed one
  Gemini generation, private Storage validation and a usable design revision.
- [x] RV-11
- [x] RV-12
- [x] RV-13 (baseline sandbox preserved; full-contract rerun after BE-09 passed)
- Evidence: [2026-10-11 VNPay Railway rehearsal](evidence/rv12-13-vnpay-railway-2026-10-11.md)
  completed genuine provider checkout/IPN, signed QueryDr, once-only ledger and
  same-identity access promotion. Controlled prerequisites do not close RV-15;
  Hobby egress is dynamic and production-money acceptance remains separate.
- Revised BE-09 rehearsal: [RV-13 → media/AI runtime evidence](evidence/rv13-media-ai-runtime-2026-10-11.md).
  Full-contract sandbox deposit 2,433,001 VND passed genuine IPN/QueryDr and
  once-only settlement/FULL promotion. RV-08–11 passed sequential runtime gates,
  including the Supabase duplicate-status fix and audited Manager recovery.
  The one new Gemini authorization was consumed exactly once; conservative
  observed token-cost estimate 0.043957 USD. Fix source passed all 1587 CI tests;
  PR #28 remains draft for review. Developer verification is separate from production readiness.
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

BE-01–05 completed 2026-10-11 for backend scope: scoped couple profiles,
immutable service/print catalog history, Manager HTTP and safe template readers.
[Acceptance evidence](./evidence/be01-05-commercial-foundations.md): 189 files /
1,512 tests plus 33 contract tests, per-file coverage gates, migration/runtime
proof and final adapter rerun. [API/provider hand-off](../docs/be01-05-commercial-foundations.md).
This does not complete BE-06–17 or pending external-provider RV gates.

- [x] BE-01
- [x] BE-02
- [x] BE-03
- [x] BE-04
- [x] BE-05
- [ ] BE-06
- [ ] BE-07
- [ ] BE-08
- [ ] BE-09
- [ ] BE-10
- BE-06–10 implementation is present on `codex/commercial-contracts-step-4`
  (2026-10-11), with [API/deployment handoff](../docs/be06-10-commercial-contracts.md).
  Acceptance remains open: automated regression/coverage, real migration/concurrency,
  rendered PDF and full-total sandbox evidence have not been established in this turn.
- Follow-up API verification: [2026-10-11 actual responses](./evidence/be06-10-api-results-2026-10-11.md).
  Six contract routes plus related payment APIs were exercised against disposable
  PostgreSQL, with migration and rendered Vietnamese PDF proof. Controlled VNPay
  evidence does not close the genuine full-total sandbox recheck or all acceptance gates.
- [ ] BE-11
- [ ] BE-12
- [ ] BE-13
- [ ] BE-14
- [ ] BE-15
- [ ] BE-16
- [ ] BE-17

Kế hoạch bước 6 (BE-11–16): [phụ lục, fulfillment thiệp, phát sinh, hóa đơn cuối và điều chỉnh](plan.md).
Kế hoạch chia nhỏ theo owner, có checkpoint PostgreSQL/ledger/payment và giữ các task
ở trạng thái chưa hoàn tất cho đến khi code được wired, verified và có bằng chứng.

## SPEC-06–11 — Backend Only

Every task in this section, including SPEC-06, is backend-only. No frontend task,
client generation, browser screenshot or native build is included in these backend
checkboxes. API examples and hand-off documents are delivered to the frontend team;
the frontend team owns its implementation separately.

### SPEC-06 — Guest Management

Safe isolated work may start against accepted owner contracts; integrated acceptance
requires real Booking access and ordered headcount providers. Invitation publication
is required only for optional personalized-link integration, not Groups/list/planning.

- [ ] GM-W1: Implement Groups + optional one-person Guests/import and independent explicit planning revisions; initialize from existing Booking count, never derive/reset total from an empty/partial list; verify normalization, atomic imports and retained references.
- [ ] GM-W2: Implement optional Guest-scoped read-only credentials/exchange/view/reissue; generic invitation/QR works with no Guest list; verify privacy, hash-only storage, expiry/rate/denials; no guest attendance writes.
- [ ] GM-W3: Implement explicit-total ordered Booking sync and named Guest search/list/group reporting/delivery ports; distinguish planningHeadcount/listedGuestCount, verify stale/replay/rollback and minimum-data conformance; Guest changes never enable check-in.
- [ ] GM-W4: Mount strict Groups/Guests/planning HTTP/Zod/OpenAPI with names-free/partial-list examples and denials; no Household identities; companion-dependent fields require the narrow clarification above; publish exact provider/API versions.
- [ ] GM-W5: Verify no-list -> Group seating/printing/event/invoice path and explicit-count -> Seating/print invalidation with real owners; import/archive do not change planning; migrations/concurrency/history proof; automatic personalized sending needs explicit recipient and real Notifications adapter.

### SPEC-07–11 — Backend Only

- [ ] SEA-W1: Compatibility/remapping and capacity tests use independent planningHeadcount, never Guest count; Groups/table labels work with no named list.
- [ ] SEA-W2: Immutable plan persistence and migration/revision proof.
- [ ] SEA-W3: Confirmation/exception/print registry/optional Staff guidance with real owner conformance and rollback/race tests; no-list/NONE mode cannot block a compatible layout/print.
- [ ] SEA-W4: HTTP/OpenAPI and authorization; no geometry/person-seat writes.
- [ ] SEA-W5: Backend acceptance evidence and frontend hand-off.
- [ ] STF-W1: Staff provisioning/assignments plus NONE/BY_GUEST_NAME configuration; owning FULL Couple/Manager explicit enable requires active names; adding/importing names never enables; after first record mode cannot hide history.
- [ ] STF-W2: Named Guest append-only CHECK_IN/UNDO journal; effective count 0/1 per Guest; real duplicate/replay/undo/archive/revocation/mode concurrency tests; settle companion recording separately before dependent implementation, without prohibiting accompanying people.
- [ ] STF-W3: Named Guest search/Group guidance and mode-aware reporting providers; NONE -> null/not recorded, enabled -> listed-guests-only counts with retained Group history; no whole-event attendance inference.
- [ ] STF-W4: Strict mode/Guest check-in/undo HTTP/OpenAPI, assigned-scope/disabled-mode denials and privacy/retry proof; no Household identities; companion payload/correction rules follow the narrow confirmed clarification, not an inferred ban.
- [ ] STF-W5: Backend acceptance evidence and frontend hand-off.
- [ ] NTF-W1: Durable intents/recipient/device/channel registry and migration proof.
- [ ] NTF-W2: Optional explicit-recipient Guest credential delivery, encryption and safe template/provider handling; absent names/contacts do not block generic invitation or other wedding notifications.
- [ ] NTF-W3: Contract/appendix/payment/invoice/print and guest-plan handlers; no response events/deadline jobs.
- [ ] NTF-W4: Due scheduler/reconciliation, media/D-3/completion jobs, retry/unknown/dedup proof.
- [ ] NTF-W5: Settings/inbox/operations HTTP, outbox/provider integration evidence and frontend hand-off.
- [ ] ANL-W1: Source formulas include agreed services/appendices/expenses/final invoices; separate explicit planning, optional named-list count and nullable mode-aware check-ins; no response metrics, disabled zeros or partial-list whole-event turnout rates.
- [ ] ANL-W2: Projection/checkpoint/rebuild with monotonic source ordering.
- [ ] ANL-W3: Authorized analytics HTTP/OpenAPI and bounded query/freshness proof.
- [ ] ANL-W4: Deterministic fixture/real-source backend acceptance and frontend hand-off.
- [ ] REL-W1: Backend environment/auth/config/manifest validation.
- [ ] REL-W2: Deterministic idempotent backend seeds/journeys: no names + Group seating + NONE through contract/deposit/print/event/final invoice, plus partial names + explicit check-in/undo; list changes never alter planning/money.
- [ ] REL-W3: Empty/upgrade migrations, backend staging/runtime health/recovery evidence.
- [ ] REL-W4: Immutable API/provider manifest and frontend release integration checklist; frontend delivery recorded separately.
- [ ] REL-W5: Backend go/no-go evidence and recovery hand-off; full product release waits for frontend integration.

## Verification Record

For each completed task append exact command, result, environment, immutable provider
version/API digest and evidence link to the owning module evidence. A skipped database
test is not migration/integration proof. Do not tick future commercial/guest tasks
merely because this requirements amendment was confirmed.
