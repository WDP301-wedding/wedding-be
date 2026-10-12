# SPEC-09 → RV-16 → GM-W5 backend acceptance

This checkpoint continues the colleague's `883c2cb` implementation on
`codex/notifications-step-12`. The accepted executable revision is
`a424777a3b723982162604566e99bc5d1c89560e`; later evidence/documentation commits do
not change that executable tree. The original competing checkout was preserved.

The owner authorized the existing Railway backend and connected Supabase database,
and one verification email to the supplied mailbox. Runtime fixtures used an owned,
isolated Supabase schema. Synthetic canonical settlement records in that schema
exercise owner adapters; they are **not** payment-provider or production-money
evidence. Existing RV-14/RV-15 sandbox financial evidence remains separate.

## Acceptance matrix

| Gate | Evidence |
| --- | --- |
| NTF-W1 | Durable intent/recipient/device/inbox/command stores; concurrent dedup/claim and immutable receipt/attempt guards. Fresh migration and populated upgrade tests preserve Group/Guest planning, settlement, PDF digest and nullable NONE attendance. All five previously applied notification migration checksums match exactly. |
| NTF-W2 | Explicit-recipient delivery uses the native Guest transaction and encrypted, purpose/booking/intent-bound material. Replay keeps one Guest credential and one intent. Native tests cover revocation, TTL, rollback, minimal Guest views and terminal purge. The real Brevo delivery report confirms the single verification message, with ciphertext purged afterward. |
| NTF-W3 | Read-only producer adapters consume real Identity, Booking, Billing, Invitation and Guest facts. The native commercial journey covers contract/appendix/payment/refund/final invoice/print/access facts, stable replay IDs, unchanged ledger and redacted intent data. No response jobs or attendance authority are added. |
| NTF-W4 | The actual Railway worker uses recurring timers, durable scans, fresh per-send leases, bounded retries and UNKNOWN reconciliation. D-3, media cutoff and +12h completion invoke native owner adapters. Restart preserves reminder IDs and completion command identity. |
| NTF-W5 | Strict settings/inbox/read/registry/status/requeue/Guest-delivery HTTP and OpenAPI contracts; current identity authorization and private response policy. Native HTTP/security tests and deployed smoke checks complement the real email provider receipt. [Backend hand-off](../../docs/notifications-step12.md). |
| RV-16 | Hosted start/stop/restart, expired lease → UNKNOWN with one attempt/no resend, controlled IN_APP retry → delivery with the same intent/two attempts, real email reconciliation, D-3/media timers, +12h completion and late replay → REPLAYED. One completion event, unchanged settlement and no UI-triggered worker execution. |
| GM-W5 | No named Guests → Group-labelled native Seating → actual PDF → native event completion → zero-incidental-expense immutable final invoice → real Notifications consumer/dispatcher. Import/archive preserve planning. An explicit in-range planning-count change rejects a new print and makes Seating require review; the historical PDF hash and contract digest remain unchanged. |

## Verification and source integrity

[Linux CI for the executable revision](https://github.com/WDP301-wedding/wedding-be/actions/runs/38267911671)
passed both jobs: formatting, lint, typecheck, unit/contract tests, generated OpenAPI,
production build, locked dependency audit, empty migrations, 466 integration tests
across 89 files, and full-suite coverage with PostgreSQL (1,780 tests across 249 files).
Aggregate coverage: 96.48% statements, 93.13% branches, 98.44% functions, 97.41% lines.
The existing **80% branches and lines per file** gates remain unchanged. The
PostgreSQL job timeout increased from 10 to 20 minutes because integration and
coverage each take about five minutes; no test or coverage check was removed.

Local disposable PostgreSQL additionally passed 32 Notifications integration tests,
79 Seating/print/commercial HTTP tests including both GM-W5 journeys, and the
populated additive-upgrade test. OpenAPI generation/check and the production build
passed. Frontend/native builds and screenshots are outside backend acceptance.

The rollout and exact compiled-module/API/migration checks are recorded in
[the machine-readable manifest](notifications-provider-manifest-2026-10-12.json).
Railway CLI uploads do not populate a platform Git revision: the archive's exact
Git source and comparison of compiled module bytes establish source identity.
Health results supplement these checks; health alone is not provider evidence.

Final deployment `f2b25205-2f40-4b80-999d-3115e039f1c1` is SUCCESS. All 311 compiled
human-authored modules, deployed OpenAPI and all 53 applied migration checksums
match the executable source. Deployed settings/inbox/registry/operations HTTP smoke
checks return 200 for valid sessions, 401 anonymously and 422 for an extra body key,
with no-store/no-referrer responses. The operator fixture was retired. Actual server
logs show the worker completing recurring runs automatically, with no worker failure
in the inspected interval. The task-scoped Railway SSH key was revoked and removed.

## Hosted fixture and provider evidence

The rehearsal ran on Railway deployment `eef9eb10-69b7-4b3f-a31e-85f1695c703c`,
against owned schema `ntf_rv16_edd0b9f9cfb4493195b69841b00a900f`. The scheduler,
runtime composition, worker and email-delivery compiled hashes match the accepted
revision. Time changes and the retry fault were confined to this test process.

- Verification intent: `289e371c-5a97-4a50-90e6-68e335aca436`.
- Brevo message ID SHA-256: `5c88f1fcd176fcec3f8073b94bafc61f206f1bc84d795468cf381d0c85ef7be2`.
- Actual report: DELIVERED; one ACCEPTED record; encrypted content purged.
- Expired-lease intent: `e377591d-238a-4762-b61c-b596f234aa3e`, UNKNOWN, one attempt.
- Retry intent: `b590385d-cfe8-4ead-a756-21ce515bbd7c`, DELIVERED, two attempts;
  the injected failure was controlled IN_APP evidence, not a claimed Brevo outage.
- Completion command: `fb035f9c-d429-5321-83f4-8ae48bdedb8e`, DONE;
  native late replay returned REPLAYED with exactly one `booking.completed` event.

The first controlled clock was accidentally frozen. Recovery resumed the **existing
accepted email intent** with an advancing clock; no replacement message/credential
was issued. Reports, durable identities, attempt counts and unchanged settlement
were checked after recovery. Fixture sessions and Guest credentials were revoked;
domain/notification evidence was retained rather than deleting shared history.
Raw credentials, destination addresses, provider message IDs and private logs are
excluded from published evidence.

## Boundaries and remaining project work

Android installation APIs exist; Android push provider/device delivery is disabled
and remains a client/provider dependency. The personalized Guest fragment landing
page is a frontend dependency; this checkpoint proves backend credential and email
transport behavior, not an end-user browser journey through that page.
Existing synchronous Identity credential email remains in place. Ambiguous delivery
without a provider queryable ID stays UNKNOWN and cannot be blindly requeued.
The deployment is the owner-approved developer test target despite its Railway
`production` label; this is not a production-readiness or production-payment claim.
RV-21/Analytics/release work and human PR approval remain separate.
