# SPEC-01–05 Runtime and External Provider Audit

Audit date: 2026-10-10 (Asia/Saigon). Starting commit: `216563f`.
Branch: `codex/spec01-05-runtime-audit`. Requested by the owner after clarifying
that VNPay/Gemini credentials had not been supplied. Scope: backend SPEC-01 Identity,
02 Venue, 03 Booking, 04 Payments and 05 Invitation, plus their Core-platform foundation.

This is a source/document/configuration audit, not a fresh runtime acceptance run.
No external provider requests, paid generations, payment transactions, database
migrations, shared-data writes or retention deletes were performed. Historical owner
acceptance and tests remain valid for their stated scope; they do not prove live
external-provider operation. All new [RV tasks](../backend-revision-todo.md#spec-01-05-runtime-and-provider-follow-ups)
remain unchecked. New commercial requirements remain in BE-01–17.

## Evidence Rules

Keep these dimensions separate for every feature:

| Dimension | What it proves | What it does not prove |
| --- | --- | --- |
| Implemented code | Adapter/service/router and owned persistence exist | Correct credentials, live protocol compatibility, deployed execution |
| Offline verification | Unit/contract tests, controlled SDK/fetch, real local owner/DB integration | A provider received the request, delivered mail, produced an image or settled payment |
| Configuration present | Required values exist in a specific inspected environment | Valid key/model/account/bucket, quota, delivery, deployed configuration |
| Live/runtime verified | Authorized operation on the named target with provider/HTTP/persistence evidence | Another environment, changed code/model/config, production-money acceptance from sandbox |

Finding labels: `CONFIGURATION_MISSING`, `LIVE_EVIDENCE_PENDING`,
`IMPLEMENTATION_GAP`, `DOWNSTREAM_PENDING`, `OPTIONAL_DISABLED`.
Missing evidence is not proof that code is broken or that an operator never tried it.
If new evidence exists outside the repository, attach a redacted record before closing
its task. Credential presence, CI success, read-only bucket/sender verification and a
health 200 response are never substitutes for feature-level proof.

Required disabled features stay open and block claims about their full journey.
An owner may explicitly defer them for a limited demo, whose manifest must state that
limitation. Optional disabled telemetry is not described as live verified. Paid/live
tests require explicit bounded authorization and test accounts/data, never real guests.

## Summary Matrix

| Scope | Classification | Remaining gate / task |
| --- | --- | --- |
| Core deployed DB readiness | IMPLEMENTATION_GAP + LIVE_EVIDENCE_PENDING | Bounded probe exists but is not wired in startFromConfig; RV-02 |
| Identity Manager bootstrap | IMPLEMENTATION_GAP | Service exists; secure operator CLI absent in inspected entry points; RV-03 |
| Identity/Booking email and auth | LIVE_EVIDENCE_PENDING | Selected Brevo mailbox/OTP/invitation and actual host transport proof; RV-04/05 |
| Identity/Booking retention | LIVE_EVIDENCE_PENDING | Populated safe operational rehearsal and assigned run procedure; RV-06 |
| Venue/Invitation Storage | LIVE_EVIDENCE_PENDING | Local configuration/read-only bucket check is not upload/signed-read proof; RV-07/08 |
| Invitation public origin/QR | CONFIGURATION_MISSING locally + LIVE_EVIDENCE_PENDING | Origin/routing/assets/QR/unpublication; RV-09 |
| Invitation Gemini | CONFIGURATION_MISSING locally + LIVE_EVIDENCE_PENDING | Real generation/Storage and unknown-effect recovery; RV-10/11 |
| Payments VNPay | CONFIGURATION_MISSING locally + LIVE_EVIDENCE_PENDING | Sandbox setup, deposit and balance; RV-12/13/14 |
| Booking/Billing deployed journey | LIVE_EVIDENCE_PENDING | Real external sandbox boundary and target owner composition; RV-15 |
| Outbox/due automation | DOWNSTREAM_PENDING | Actual SPEC-09 consumer/scheduler and operating procedure; RV-16 |
| Invitation print-file output | IMPLEMENTATION_GAP + DOWNSTREAM_PENDING for seating | Approved deferred contract/renderer; RV-17/18/19 |
| Core telemetry | LIVE_EVIDENCE_PENDING; OPTIONAL_DISABLED for unselected export | Target logs; selected metrics/collector only; RV-20 |
| Feature-mode manifest | LIVE_EVIDENCE_PENDING | Exact environment/version/limitations, not a blanket ACCEPTED claim; RV-01/21 |

## Local Configuration Snapshot

Only key presence was examined through dotenv parsing of `.env` and `.env.demo`.
No values, recipient addresses, URLs, provider keys or credentials are copied here.
This snapshot is not the current Railway/Vercel environment or running-server state.

| Group | .env | .env.demo | Interpretation |
| --- | --- | --- | --- |
| Database runtime/migration URLs | Present | Present | Connection target validity and deployed readiness require separate evidence |
| Supabase URL/key/bucket | Present | Absent | Shared configuration exists; demo cannot prove real object storage |
| Brevo key/sender | Present | Absent | Selected local provider configured; demo cannot prove delivery |
| Legacy Resend key/sender | Absent | Absent | No requirement to activate both email providers |
| OTP hash key | Absent | Present | Deployed stable secret must be checked separately; development has an ephemeral fallback |
| VNPay four settings | Absent | Absent | Checkout integration cannot be treated as live verified |
| AI selector/key/model | Absent | Absent | Gemini generation is not configured in these files |
| PUBLIC_INVITATION_ORIGIN | Absent | Absent | Publication disabled for these settings |
| Metrics token / OTLP endpoint | Absent | Absent | No proof of protected metrics or external trace ingestion; optional scope |

## SPEC Coverage and Findings

### Core-platform: External Adapters and Deployment

- [Core evidence](./core-platform.md) accepts provider interfaces/adapters using no
  paid/network calls. This is intentional offline proof, not live acceptance.
- [Railway runbook](../../docs/railway-deployment.md#verification-and-recovery)
  records database deployment and read-only bucket/sender checks, but explicitly
  leaves authorized email delivery/login verification separate. It states that
  readiness currently represents application lifecycle, not a DB query.
- [server.ts](../../src/server.ts) passes no database probe to `startServer` in
  `startFromConfig`; the injection contract exists. `RV-02` is a wiring/rehearsal gap,
  not a claim that production DB is disconnected.
- [Venue runtime](../../src/modules/venue-catalog/venue-catalog.runtime.ts) selects
  FakeStorageProvider when disabled; [email factory](../../src/integrations/email/email-provider.factory.ts)
  selects FakeEmailProvider. Audit these development fallbacks and deployment
  validation so they never count as real delivery/storage proof (`RV-01`).
- [Tracing](../../src/core/observability/tracing.ts) is conditional; collector/scrape
  and actual logs require target evidence if selected (`RV-20`). No new vendor or
  multi-replica infrastructure is inferred from this audit.

### SPEC-01: Identity Access

- [Identity evidence](./identity-access.md) proves auth/refresh/invitation/promotion
  and retention against disposable PostgreSQL and client tests. It does not document
  real delivered mail with the currently selected provider/hosts.
- [Identity runtime](../../src/modules/identity-access/identity.runtime.ts) now mounts
  password OTP and returns `410 PASSWORD_OTP_REQUIRED` from legacy reset-link commands.
  Historic reset-link text cannot be used as an active acceptance path. `RV-04/05`
  cover mailbox delivery, current OTP workflow, invitation acceptance, actual secure
  transport/rotation/revocation and deployed stable OTP secret.
- [Bootstrap runbook](../../docs/identity-access-operations.md#initial-manager-bootstrap)
  requires an operator CLI with hidden password input/target/operator/audit. The
  [account service](../../src/modules/identity-access/account/account.service.ts)
  has `bootstrapInitialManager`, but inspected scripts/package commands have no
  corresponding secure operator CLI. Demo seeding is not that CLI (`RV-03`).
- Identity/consultation retention executors exist. Tests do not prove an operator
  schedule, populated target rehearsal or recovery procedure has been used (`RV-06`).
  The approved retention policy is retained; no new destructive policy is invented.

### SPEC-02: Venue Catalog

- [Venue evidence](./venue-catalog.md) proves real local persistence, publishing,
  immutable layouts/stable table IDs and HTTP authorization. Its browser test uses
  a contract-shaped mock, not a deployed Storage object round-trip.
- Real Supabase SDK adapter code exists. Current live evidence is only the runbook's
  read-only bucket check. Upload/info/checksum/attach/signed download/refresh/privacy
  and retained-history behaviour still require `RV-07`.
- Restaurant layout geometry belongs to Venue and is implemented in the accepted
  scope. Couple selection/group-labelled seating is SPEC-07, pending SEA-W1–5;
  a catalog layout editor is not proof of the future seating/print journey.

### SPEC-03: Booking Lifecycle

- [Booking evidence](./booking-lifecycle.md#postgresql-and-migration-proof) explicitly
  excludes a real payment gateway/email account/live provider. The Brevo runtime test
  uses mocked fetch. Real first-party Identity/Venue/Booking integration is valuable,
  but it does not deliver a real mailbox invitation or provider-verified deposit.
- `RV-04` closes the authorized consultation invitation mailbox path; `RV-13/15`
  close genuine sandbox money -> slot/Booking -> same-identity promotion and deployed
  multi-actor lifecycle. The demo's direct settlement fixture is not payment proof.
- [Booking providers](../../src/modules/booking-lifecycle/booking-lifecycle.providers.ts)
  expose `createAutomationWorker`; inspected server/runtime provides no running due
  scheduler/outbox dispatcher. Actual cutoff/D-3/completion execution depends on
  Notifications and operations (`RV-16`, existing NTF-W1/3/4), not merely owner ports.
- Contract/profile/deposit amendments are new BE tasks. Prior timeline acceptance
  does not imply BE-07/09/11 or the revised final-invoice journey are implemented.

### SPEC-04: Payments and Billing

- [Payment evidence](./payments-billing.md#w4-vnpay-verification-and-reconciliation)
  uses controlled protocol/transport data, not live merchant transactions. The
  [acceptance fixture](../../tests/integration/payments-billing/acceptance-fixture.ts)
  controls VNPay transport while executing real Booking/Billing owners.
- [VNPay protocol](../../src/modules/payments-billing/infrastructure/vnpay.protocol.ts)
  hardcodes sandbox checkout/query endpoints. [Providers](../../src/modules/payments-billing/payments-billing.providers.ts)
  set VNPay to null when disabled. No supplied local settings means setup is still
  required; merchant registration and IPN/return routing are `RV-12`.
- Deposit success/access promotion requires a genuine provider-hosted sandbox
  checkout/IPN/status journey (`RV-13`). The balance path needs its own payment
  proof/version/ledger checkpoint (`RV-14`), not just reuse of deposit evidence.
- Operational manual accounting/change/cancellation and deployed owner composition
  remain a staged verification gate (`RV-15`); a ledger manual-refund record is not
  proof a bank refund happened. Automatic VNPay refunds remain excluded.
- Production-money acceptance is not implied by sandbox and is not silently added
  to scope. If requested, obtain separate approval for merchant/endpoint/adapter and
  financial operational review. `RV-21` must state the selected mode and limitations.

### SPEC-05: Invitation Studio

- [Invitation checkpoint](../../SPEC-invitation-studio.md#14-w2w4-backend-implementation-checkpoint--2026-10-09)
  and [controlled Storage](../../tests/integration/invitation-studio/controlled-storage.ts)
  explicitly verify Gemini/Supabase adapters without live network. [Review fixes](./spec05-review-fixes.md)
  prove canonical Booking/Billing persistence and atomic print charges; neither is
  live paid generation or object-storage proof.
- [Invitation runtime](../../src/modules/invitation-studio/invitation-studio.runtime.ts)
  uses unavailable Storage when absent and null AI when unselected. Missing
  PUBLIC_INVITATION_ORIGIN disables publication. Wedding media needs `RV-08`, public
  routed assets/HTML/generic QR and unpublication need `RV-09`.
- Gemini is image/background assistance from a bounded prompt, not autonomous full
  invitation design. Real model/key/quota/output/storage/design integration needs
  `RV-10`. Durable unknown-effect reconciliation needs fault/operational proof
  (`RV-11`) without repeatedly purchasing generation; do not send private photos.
- [Approved print-file follow-up](../../SPEC-invitation-studio.md#11-approved-print-file-output-follow-up-2026-10-08)
  remains explicitly pending. Current printable snapshot/order routes and public
  HTML are not authorized printable-file rendering/download. Add output contract
  (`RV-17`), renderer without seating (`RV-18`) and real Seating output (`RV-19`).
  BE-08 is contract PDF, not an invitation print renderer. BE-12 governs charging.
- Real Seating/Guest/Notifications consumers remain downstream, not implicitly
  implemented by accepted registry doubles or recorded outbox rows. Keep SEA/GM/NTF
  dependencies visible and verify after their actual producers/consumers are wired.

## Follow-up Order and Closure

Use the RV table/checkpoints in the active backlog; do not maintain competing
checkboxes in this report. `RV-01` inventories enabled required features first.
Database/Manager/email/Storage readiness precedes provider smoke runs. VNPay can be
checked in sandbox; money-mode limits remain explicit. Revised monetary semantics
must rerun proof after BE-09/12/15/16, even if the legacy provider journey passed.
Print without seating can proceed after its output contract; real seating waits for
SEA-W3/5. Automatic due/recovery execution waits for NTF wiring or an explicit audited
operator procedure; nothing is claimed to run automatically during this audit.

For each closure record date/operator/authorization, target/provider mode, exact code
and API digest, relevant tests, bounded request/receipt correlation, persisted result,
failure/retry behaviour and unresolved dependencies. Redact secrets/PII and retain
private raw provider proof outside committed docs. A code/config/model/environment
change that invalidates evidence reopens that feature's verification gate, not all
historical module checklists. RV-21 and REL-W3–5 consume the resulting manifest.

## Audit Verification

Read all five SPECs and foundation scope, acceptance records, current runtime/adapters,
relevant controlled-provider fixtures, operations/deployment docs and active backlog.
Inspect local dotenv key presence only. This audit does not rerun the historical
application suites or validate the deployed provider accounts. Document formatting,
relative links, RV task uniqueness/coverage and diff checks are verified separately
when publishing these changes; do not count them as feature-level live acceptance.

Completed audit-only checks:

- `npm exec prettier -- --check AGENTS.md docs/team-implementation.md`: passed.
- Planning/evidence files preserve the repository's manually formatted `tasks/` convention.
- Structured local link scan: 56 relative file links exist; no missing file target.
- RV checklist audit: 21 unique table definitions and 21 matching unchecked tasks.
- `git diff --check`: passed. No application source, migrations, API or client files changed.
