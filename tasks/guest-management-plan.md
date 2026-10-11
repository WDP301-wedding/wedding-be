# SPEC-06 GM-W1–W4 implementation

2026-10-12, backend only; starting branch `codex/guest-management-w1-w4`.
Authoritative scope: `docs/backend-scope-2026-10-10.md`, `SPEC-guest-management.md`.

1. GM-W1: additive persistence, stable default/custom Groups, optional one-person
   Guests, atomic preview/import, independent immutable explicit planning revisions.
2. GM-W2: hash-only personalized credentials and short-lived view capabilities;
   current published Invitation reader; reissue/archive/expiry revocation.
3. GM-W3: real Booking serialization/synchronizer, minimum-data search and reporting
   readers, explicit-recipient delivery preparation port (Notifications delivery pending).
4. GM-W4: authenticated strict HTTP, OpenAPI schemas/examples/errors and runtime
   composition; disposable PostgreSQL, regressions, coverage and exact hand-off.

No companion quantities are assumed. Guest CRUD does not change planning, check-in
mode or money. Existing migrations/evidence and frontend repositories are retained.
GM-W5, live Notifications/Seating acceptance and deployment remain separate.

Validation: focused red/green Vitest per slice, empty/populated disposable migrations,
atomic failure/concurrency/replay tests, typecheck/lint/test/build/contract/coverage,
OpenAPI generation/check. No paid generation, payments or shared database writes.

GM-W1–GM-W4 implementation and local acceptance are recorded in
[the evidence](./evidence/guest-management-w1-w4-2026-10-12.md) and
[backend hand-off](../docs/guest-management-w1-w4.md). Exact full-suite CI acceptance
is tracked separately from Windows runner diagnostics and live/deployment readiness.
