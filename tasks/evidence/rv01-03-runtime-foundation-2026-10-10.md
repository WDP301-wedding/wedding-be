# RV-01–03 runtime foundation evidence

Verified on 2026-10-10. Backend-only follow-up to the historical
[SPEC-01–05 audit](./spec01-05-runtime-audit-2026-10-10.md).
The owner explicitly authorized migrations, mutations, controlled DB faults and
backend restarts on the developer-only Railway/Supabase target. Railway names
the environment `production`; this is not production acceptance.

Source revision: `2407683acf51cc76e3ae7fe5706a3eee1927be6f`.
Deployment: `2d9d1f7b-0007-48ac-8085-392a4c181a86`.
Target: `https://wedding-be-production-e1dc.up.railway.app/`.
PR: [#20](https://github.com/WDP301-wedding/wedding-be/pull/20), awaiting team
review before merge. The owner-authorized feature-branch deployment retains
GitHub `main` autodeploy and Wait for CI; neither was changed.

The CLI upload does not provide `RAILWAY_GIT_COMMIT_SHA`, so startup reports
revision `null`. The upload message records the source revision. SHA-256 hashes
of six compiled runtime/CLI artifacts match the local build of that revision.
The [redacted machine record](./rv01-03-runtime-foundation-2026-10-10.json)
keeps source attribution separate from startup metadata.

## Implemented code and configuration: RV-01

Startup and `runtime:manifest` expose an allowlisted feature matrix. Tests reject
credential/model/URL leakage and do not promote configuration into verification.
Offline/live fields require separate evidence; absent providers cannot become
live successes through a fake adapter or a healthy endpoint.

| Feature | Target configuration / implementation | Offline evidence | Live scope / remaining task |
| --- | --- | --- | --- |
| Database | PostgreSQL configured | Real disposable readiness/lifecycle and migration tests | TLS, schema, fault/recovery and restart below; RV-02 verified |
| Email | Brevo configured | Existing adapter/Identity/Booking tests in passing CI | Delivery/invitation/OTP pending RV-04 |
| OTP key | Stable secret configured | Configuration and Identity tests | Restart/auth workflow pending RV-05 |
| Catalog Storage | Private Supabase configured | Existing transport/owner tests | Object round-trip pending RV-07 |
| Invitation Storage | Private Supabase configured | Existing transport/owner tests | Media workflow pending RV-08 |
| Gemini | Unconfigured; adapter implemented | Existing controlled-transport tests | Paid generation/recovery pending RV-10/11 |
| Public invitation | Origin unconfigured; feature disabled | Existing publication/QR tests | Routed publication pending RV-09 |
| VNPay | Unconfigured; adapter sandbox-only | Existing signing/settlement tests | Genuine sandbox workflow pending RV-12–14 |
| Retention | Operator CLI implemented; unscheduled | Existing policy/repository tests | Populated operational rehearsal pending RV-06 |
| Workers | Ports/outbox only; downstream pending | Port tests only | Actual consumers pending RV-16 / SPEC-09 |
| Print files | Renderer missing | No renderer acceptance | RV-17–19 remain open |
| Metrics / tracing | Unconfigured; optional disabled | Existing instrumentation tests | No scrape/collector acceptance claimed; RV-20 remains open |

Disposable test configuration disables external providers. Email invitation and
catalog Storage development fakes are documented; password OTP without email
and Invitation Storage without a provider fail unavailable. No fake Gemini
generation or VNPay settlement is introduced. See the
[operator runbook](../../docs/runtime-foundation-operations.md).

## Offline verification

[Linux CI run 38056043843](https://github.com/WDP301-wedding/wedding-be/actions/runs/38056043843)
passed both jobs on the exact source revision: formatting, lint, typecheck,
unit/contract tests, OpenAPI consistency, build, dependency audit, empty-database
migration, integration and full-suite coverage. PostgreSQL integration passed
62 files / 332 tests; coverage passed 185 files / 1,482 tests. Coverage: statements
96.36%, branches 93.25%, functions 98.17%, lines 97.16%. Existing per-file 80%
line/branch thresholds remain unchanged.

The new five disposable PostgreSQL tests exercise deployed composition, bounded
locked-ledger failure, incompatible checksum, resource shutdown, first/repeated
and concurrent bootstrap, real child CLI descriptor input, and audit-failure
rollback/retry. Concurrency creates one Manager/audit; forced audit failure leaves
account/role/credential/audit counts at zero. Secret-reader tests cover all TTY
descriptors, editing, cancellation, bounds and terminal restoration. A mutation
inverting the target comparison was killed by the unit tests.

Independent agent review found two required issues (TTY descriptors other than 0,
and resources when app construction fails); both were fixed and re-reviewed.
Windows full-suite attempts encountered native Node worker crashes and
contention timeouts; focused checks passed. The complete authoritative run is the
pinned Node 24.21 Linux CI above, not a claim that those Windows attempts passed.

OpenAPI remains unchanged, artifact digest
`6f92021e6c8fa7f4f094cc65b3bcf165adf82d819cf18bdf8ad8b70f8307297e`.
No applied migrations or frontend source were changed.

## Live database readiness and recovery: RV-02

The deployed composition owns a one-connection readiness pool, with 4-second
acquisition, 700-ms query and 5-second HTTP bounds. Concurrent probes share one
operation; failures destroy the connection. Migration compatibility requires all
26 shipped checksums and completed records. This is not arbitrary manual schema
drift detection. Direct Supabase connections use verified TLS with the reviewed
CA; runtime inspection confirmed encrypted and authorized TLS and 26/26 matches.

At `2026-10-10T13:42:43.234Z`, a bounded exclusive migration-ledger lock plus
termination of one readiness connection produced:

| Phase | Ready | Live | Evidence |
| --- | --- | --- | --- |
| Baseline | 200, 1,391 ms | 200, 81 ms | Ready request `c6cb21ef-0c9b-47be-8224-1f1b59d90967` |
| Controlled fault | 503, 1,856 ms | 200, 49 ms | `SERVICE_UNAVAILABLE`, request `745246e1-7a0f-4184-98c1-2bb745c63e90` |
| Rollback / recovery | 200, 1,308 ms | Independent | Request `1096c9c7-795d-4394-b970-7a25eaa54c59` |

This deployed fault proves query unavailability and lost-connection handling,
not a whole Supabase provider/network outage. Separately, stopping the isolated
loopback PostgreSQL 18 process produced ready 503/live 200; restarting it recovered
ready 200. Application data was not mutated by either health rehearsal.

Railway restarted the same release at `13:43:29.761Z`. Two startup manifest events
were recorded (initial `13:41:38.454Z` and restart); no startup/shutdown failure event
was recorded. Readiness after restart was 200, migration/TLS checks remained valid,
the old readiness PID was absent, and compiled artifact hashes were unchanged.
Resource-close and construction-failure tests provide the lifecycle assertions.

The first release attempt was correctly rejected with Prisma `P1002`: a disconnected
local rehearsal had left its migration advisory lock held. The correlated idle
migration session was terminated, the owned schema was removed, and deployment
retried successfully with advisory locking, migration and readiness gates intact.
No shared developer sessions were terminated by that cleanup.

## Live operator rehearsal: RV-03

At `2026-10-10T13:45:41.938Z`, the compiled operator CLI ran inside the deployed
Railway container against an owned Supabase schema containing all 26 migrations.
Input pinned the production environment label, target fingerprint, operator and
confirmation. A fresh random secret was held in memory and passed through stdin
descriptor 0, never argv, environment, logs or committed files.

First exit code: 0; repeated exit code: 1. Persisted counts: one account, one Manager
role, one password credential and one bootstrap audit. Audit request
`a1178911-fc41-41ba-8606-d995ce1c97db` matches the CLI result; audit metadata contains
only environment and operator. Captured CLI output contains neither secret nor
mailbox. TLS was encrypted and authorized.

The owned rehearsal schema was removed. Final inspection at `13:46:31.995Z` found
zero rehearsal schemas and zero Managers in the public application schema. No
persistent demo password/account was seeded. The intended first application
Manager remains an explicit operator action with the intended email and unique
secret, using the supplied CLI.

RV-01, RV-02 and RV-03 are verified for this revision and authorized target.
RV-04–21 and commercial/profile/SPEC-06 work remain separate gates. Email/Storage
credentials and this health/bootstrap evidence do not close those provider tasks
or establish production readiness.

Cleanup: the ephemeral SSH key was revoked on Railway, the disposable local DB
was stopped, and no migration advisory locks remained. Automatic approval review
rejected deletion of the local private key copies and Railway-variable snapshot
with "blocked by policy". Those files remain under ignored local tooling or
outside the checkout; none is included in source/evidence or deployment upload.
