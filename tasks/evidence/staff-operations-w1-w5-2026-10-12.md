# SPEC-08 STF-W1–W5 backend evidence

Date: 2026-10-12 (Asia/Saigon). Branch: `codex/spec08-staff-operations`.
Provider: `staff-operations@1.0.0`.
Implementation source commit: `275aeb3` (after the earlier STF-W1 checkpoint `8e933da`).
Final runtime clock conformance commit: `623001b`.
Status: ACCEPTED for confirmed backend scope; source `623001b` passed the complete
Linux/PostgreSQL backend workflow. Production/live business providers remain separate.

Authority: [confirmed backend scope](../../docs/backend-scope-2026-10-10.md),
[SPEC-08](../../SPEC-staff-operations.md), [active backlog](../backend-revision-todo.md).
Hand-off: [strict API/provider documentation](../../docs/staff-operations-w1-w5.md).
Machine-readable [manifest](staff-operations-provider-manifest-2026-10-12.json).

## Scope and results

| Work item | Evidence |
| --- | --- |
| STF-W1 | Identity-owned normalized-email reuse/provisioning, Staff-only authority removal with independent Couple access retained, atomic current-session/assignment revocation; unique retained assignments; NONE default and explicit active-name enablement |
| STF-W2 | CHECK_IN/UNDO append-only ledger, at most one effective count per Guest, idempotent receipts, first Group snapshots, undo/recheck-in, archived history, reasoned Manager late correction, mode permanent lock |
| STF-W3 | Real Guest and Seating ports in a shared booking scope; duplicate-name search with phoneLast4, no notes; Group-move warning; ABSENT guidance success; mode-aware absolute snapshots with sequence fence |
| STF-W4 | Twelve mounted bearer operations, strict Zod/OpenAPI input/output; role/mode/window/foreign-Guest denials; private cache headers; retry and logging privacy proof |
| STF-W5 | Disposable empty/populated migration rehearsal, actual first-party providers, concurrency/fault/rollback proof, contract artifact and frontend hand-off; final quality gates below |

Named Guest check-in is the implemented contract. A named Guest may bring other
people. Companion count storage/corrections remain unconfirmed; no companion-dependent
fields or inferred ban were added. No whole-event attendance denominator is supplied.
The owner explicitly confirmed named-only check-in and deferral of companion
quantities on 2026-10-12; this revision's execution scope is resolved.

## First-party provider and database proof

The local administrator target is `127.0.0.1:55435`, PostgreSQL 18; each suite creates
a uniquely named isolated database and applies every committed migration. No shared
Supabase/database schema was migrated. The original test target at
port 55432 was not running; owner suites instead used the existing local PostgreSQL
service to create disposable databases. The initial broad-run isolation mistake is
recorded explicitly below; final verification uses the corrected local-only runner.

`staff-operations-upgrade.test.ts` inserts a real settled/confirmed Booking and named
Guest before applying the new Staff migration, then verifies preserved planning count,
name, phase and no inferred assignments/attendance. New migration adds Staff-owned
tables and an Identity command store; foreign keys, immutable triggers and journal
state/sequence guards retain history. Existing migrations were preserved.

`staff-operations.test.ts` executes real Identity session/role readers and Staff
provisioner, settled Booking/approved shift readers, Guest services and Seating
guidance/registry. It verifies:

- NONE/no names, independent planning, names-required explicit enablement and Guest
  insertion remaining NONE; Staff cannot configure mode.
- Existing normalized-email identity reuse and unchanged Couple role/access after
  Staff disable; sessions and all assignments revoke atomically; re-enable does not
  reactivate assignments.
- Concurrent same-key check-in replay, different-key duplicate rejection, distinct
  duplicate-name Guests counted separately, concurrent undo and undo/recheck-in.
- Assignment revoke, operational-disable/check-in, archive/check-in and mode/check-in
  serialization; revoked actors cannot replay receipts.
- Disabled, unassigned, Couple, bogus QR/bearer and foreign Guest denials; Manager
  reason requirement, late correction after COMPLETED, future timestamp rejection.
- Group display/move/archive preserves measured grouping and recorded history;
  Group guidance from real Seating, successful ABSENT and denial of unadmitted scope.
- Mandatory report failure rolls back journal, configuration, receipt and outbox;
  database rejects journal deletion and mode hiding.
- Strict schemas, twelve OpenAPI operations, response validation, private headers,
  no full phone/note disclosure and no search-query PII in actual request logs.
- Absolute snapshots with a repeatable-read sequence fence; NONE -> null versus
  enabled -> named-list zero/count; outbox contains IDs/timestamps only.

## Verification record

Final source: `623001b42a3347eaeb5edb0c08ea1f4a693eab72`.
OpenAPI SHA-256: `8be62bc16348dbe60fed7c8482384beb8ba16bd9cf9d02f85a1995dd13b00f2b`.

[PR #36](https://github.com/WDP301-wedding/wedding-be/pull/36) and the
[successful exact-source workflow](https://github.com/WDP301-wedding/wedding-be/actions/runs/38204285681)
provide the authoritative final quality record:

| Gate | Result |
| --- | --- |
| Prisma generation and deploy to empty PostgreSQL 17 | PASS, all 47 migrations |
| Formatting, lint, typecheck, build, dependency audit | PASS |
| Unit suite | 139 files, 1250 tests PASS |
| Contract suite | 15 files, 41 tests PASS |
| Integration suite | 79 files, 431 tests PASS |
| Full-suite PostgreSQL coverage | 233 files, 1722 tests PASS; no skipped tests/errors |
| Coverage thresholds | 97.42% lines, 93.32% branches overall; every file satisfies unchanged 80% line/branch thresholds |
| OpenAPI generation/check | PASS; exact digest above |
| Local empty/populated Staff upgrade, native owners and HTTP | PASS; separate from interrupted broad Windows runs |

The final CI includes the empty-search regression and controlled runtime clock fix.
Its database is the workflow's disposable container service, not the application's
shared configuration. Evidence publication changes docs/checklists only afterward.
`scripts/staff-operations.verify.mjs` validates the existing local demo administrator,
creates a fresh isolated foundation database, runs actual Prisma migration deploy,
and binds DATABASE_URL/MIGRATION_DATABASE_URL to it. TEST_MIGRATION_DATABASE_URL
is the same local administrator for child disposable owner suites. It drops only its
random validated foundation database in finally. No secret values are included here.
Reproduce with `npm run demo:db:start`, then
`node scripts/staff-operations.verify.mjs --maxWorkers=1`. This runs the same Vitest
entry point as `npm test`, with all database selectors explicitly isolated.

The initial all-suite run overlapped lint/build on an 8 GB Windows host and hit
existing runtime-foundation CLI/audit test timeouts. It was stopped and does not count
as acceptance. The final run uses one worker and sequential resource-heavy gates.
The focused coverage run initially found an uncovered default constructor path;
an actual default-composition integration case was added, without lowering thresholds.

The initial broad runner set only TEST_MIGRATION_DATABASE_URL. Four core suites
(`database`, `audit`, `idempotency-http`, `idempotency-repository`) therefore inherited
the application's shared DATABASE_URL. Their synthetic AuditLog/IdempotencyRecord
fixtures used random request IDs/namespaces and completed their scoped finally
cleanup; no Booking, Guest, contract, invoice or payment-ledger facts were written.
This was an isolation error, was reported to the owner, and is not accepted as local
verification evidence. No further shared-database reads/writes were used to resolve
it. The committed runner prevents that inheritance and uses actual local migration
history for the core database tests.

The broad run also hit a 5-second timeout in the legacy populated migration
rehearsal and one Windows fork exit (3221226505). The migration test now has the same
bounded 60-second I/O budget as other migration hooks, with every assertion retained.
The three affected files subsequently passed 8 tests against the isolated local
database. Final aggregate gates are recorded separately below.

Review mutation: reversing the CHECK_IN duplicate condition made the named check-in
test fail with GUEST_ALREADY_CHECKED_IN on the first arrival. The original condition
was restored before final verification. Tests therefore detect the changed behavior.

The review also added a real empty-search regression. It failed on `Prisma.join([])`;
the corrected search skips creation of an IN list and both journal queries when there
are no matched IDs. Successful empty results retain the strict response shape.

Windows worker failures were additionally reproduced outside application tests as
the Node 24.15.0/libuv assertion `UV_HANDLE_CLOSING` during an explicit async process
exit. Interrupted/partial coverage reports are not accepted as quality evidence.
The draft PR's normal Linux/PostgreSQL 17 workflow validates exact final source.

The first Linux run reached the fixed legacy media fixture's D-3 cutoff on 2026-10-12
and correctly returned MEDIA_CUTOFF_REACHED rather than the pre-cutoff responses
expected by two HTTP tests. Runtime composition now accepts an internal clock and
shares it across Studio, Staff and Seating; those two tests explicitly use the
fixture clock. Production retains the server clock and the cutoff policy is unchanged.

## Separate readiness gates

This is local backend owner/provider persistence and mounted-HTTP proof. It is not
live mailbox delivery, a running Notifications dispatcher, an Analytics projection,
external VNPay/Gemini/Storage acceptance or production deployment. Staff provisioning
returns credential setup state and leaves password-OTP delivery to Identity; no
mail, paid generation or real-money payment was executed. Existing RV, GM-W5, NTF,
Analytics and release gates remain separate. Frontend source/build/UI were untouched.
