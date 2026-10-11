# BE-06–10 implementation record — 2026-10-11

Repository: wedding-be. Branch: codex/commercial-contracts-step-4.
Starting main: 29b3c6ca9cf389577a2648d54b9f93024192b69c.
Scope and API: [handoff](../../docs/be06-10-commercial-contracts.md).
Decision: [ADR-010](../../docs/decisions/0010-freeze-full-commercial-contracts-before-deposit.md).

## Delivered code

Contract/schema/line snapshots, multi-menu and checked integer totals, explicit
legacy conversion, scoped submission and dual approval, successor/withdrawal,
private Vietnamese PDF with retained approved bytes, exact full-total deposit
identity, once-only CONTRACT obligation and preserved legacy money.

## Review

Independent read-only correctness/security/architecture review found:

1. Mutable catalog shift times conflicted with frozen operational schedule.
2. PostgreSQL NULL semantics allowed missing document digests.
3. Direct SQL could clear monetary contract identity/current head.

Corrections use frozen proposal shift bounds, explicit non-null/null-safe checks,
immutable deposit snapshots and monetary/deferred head guards. Follow-up review
confirmed all three corrections. Review did not execute tests or a database.

## Evidence boundary

Prisma generation/schema validation, typecheck, build, lint and OpenAPI artifact
checks were run. Final toolchain/lockfile reproduction is recorded in the handoff.

No new automated tests were added or executed. No migration was applied to shared
Supabase or another database. No PDF glyph/page render inspection, full-contract
API journey, concurrency/rollback proof or genuine revised VNPay checkout was run.
The acceptance boxes BE-06–10 remain open pending those required gates.

Existing SPEC-01–05 and baseline RV-13 evidence was retained. Configuration/static
checks do not close RV-13 full-total sandbox recheck, BE-12 print production or
BE-11–16 appendix/final-invoice work.

## Subsequent API verification — 2026-10-11

The owner explicitly requested API tests after the implementation checkpoint
above. [Detailed API results](be06-10-api-results-2026-10-11.md) record five
passing scenarios, 102 actual HTTP requests across 11 endpoints, real Identity
sessions and disposable PostgreSQL 17. All 31 migrations applied successfully;
the API-produced Vietnamese PDF was rendered and inspected.

The final full regression passed 192 files / 1,530 tests. Typecheck, lint,
OpenAPI checks and changed-test formatting passed. Test setup, legacy nullable
mocks and historical-schema upgrade fixtures were corrected after the initial
regression failures; production code was unchanged in this verification turn.

VNPay evidence remains controlled signed test data, not a genuine sandbox
payment. Coverage, complete concurrency/rollback proof and full-total live
sandbox evidence remain pending; BE-06–10 acceptance boxes remain open.

## Merge preparation review correction

PR #27 initially passed its 192-file full regression, but its coverage gate
reported four new files below the existing 80% per-file branch threshold.
Thresholds were retained and tests were added for the omitted behavior.

A separate final review found normal concurrent commercial writes could return
500 after a Serializable conflict and leave the HTTP intent pending. The real
PostgreSQL race test reproduced 201/500 before the fix. Bounded whole-transaction
retry now produces one successful write and one terminal/replayable 409; direct
tests cover retry success, exhaustion and propagation of unrelated errors.
See the handoff follow-up and the latest PR CI for merge verification.
