# SPEC-06 GM-W1–GM-W4 backend evidence

Date: 2026-10-12 (Asia/Saigon). Implementation source:
`a6e79d73c55ba58a49876f8b0440c29ae74b75cf`.
Branch: `codex/guest-management-w1-w4`.
Draft PR: [#34](https://github.com/WDP301-wedding/wedding-be/pull/34).
Authoritative scope: `docs/backend-scope-2026-10-10.md` and
`SPEC-guest-management.md`; prior SPEC-01–05/RV evidence is preserved.

## Completed implementation

| Wave | Result and exercised boundaries |
| --- | --- |
| GM-W1 | Stable default/custom Groups; optional named one-person Guests; independent immutable plan revisions; atomic preview/import and stable external row keys. Native PostgreSQL proves no-list initialization, partial lists, duplicate identities, Group rename/archive/restore, normalized uniqueness, quotas, retained history and rollback on the second import row. |
| GM-W2 | Optional hash-only credential/session exchange and minimal current public invitation view. Tests prove one-time issue, reissue/archive revocation, completed-event availability until expiry, canceled/expired/unknown authority denial, session expiry, persisted rate window/reset and private-data exclusion. |
| GM-W3 | Native Booking synchronization enlisted in the same transaction; planning/listed counts stay distinct. Tests exercise sequence 11 then 10, exact replay, changed same-sequence conflict, source inconsistency, capacity, concurrency and post-sync failure rollback; fenced reporting, ranked duplicate search, minimum contact data, delegated Staff gate and explicit-recipient delivery preparation. |
| GM-W4 | Mounted runtime and 13 strict HTTP/OpenAPI operations over 10 paths. Tests exercise native Identity/Booking/Invitation authorization, cross-booking concealment, strict fields, revision/idempotency/cursor conflicts, no-store/referrer policy, no Guest attendance/response writes, and imports above 1 MiB under the dedicated 5 MiB ceiling. |

Actual tests include a planning total of 300 with zero names, then 20 imported
names; archive leaves planning 300; only an explicit 250 revision changes Booking.
Adding/importing names never changes check-in configuration or financial history.
Companion quantity storage remains unconfirmed; accompanying people are not banned.

## Local verification

Windows Node 24.15.0; repository-locked dependencies; PostgreSQL 18 on a loopback
disposable test cluster. `CatalogTestDatabase` creates a unique database per suite,
applies the committed SQL migrations and drops that database on normal completion.
No shared/cloud database URL is used. The populated upgrade test seeds native
SPEC-05 Booking data before the new Guest migration, verifies no automatic Guest
workspace/list, and preserves the existing planning total before initialization.

| Command/gate | Final local result |
| --- | --- |
| `npm run lint` | Pass, zero warnings |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run test:contract -- --maxWorkers=1 --pool=threads` | 13 files / 39 tests pass; no skips |
| `npm run api:generate`, `npm run api:check` | Pass; generated artifact matches source |
| Changed-file Prettier and `git diff --check` | Pass |
| `npm run audit:ci` | Pass under the unchanged documented, unexpired exception 1145093; no dependency/lockfile change |
| Focused Guest unit/contract/native integration coverage | 8 files / 28 tests pass; no skips; every included file meets the unchanged 80% line/branch thresholds |

Focused coverage: **99.39% lines** (489/492), **94.56% branches** (296/313),
98.15% statements (533/543), 99.26% functions (135/136). Includes all executable
Guest source plus the new Booking, Venue and Invitation owner adapters. The
coverage command is the repository's Vitest runner with a safe disposable database
environment, file filter `guest-management`, `--coverage`, include globs for those
paths, `--pool=forks --maxWorkers=1 --testTimeout=30000 --hookTimeout=60000`.
On this Windows host the successful invocation also supplies Node `--no-opt` to
the parent and worker processes. No business code, assertion, test inventory,
production deadline or coverage threshold is weakened.

Local diagnostic logs remain under ignored `.local-demo/gm/`; the test sources
and migration are committed and reproducible with the normal repository commands
and `TEST_MIGRATION_DATABASE_URL` pointing to an authorized disposable cluster.
The local runner validates the loopback admin target and does not print credentials.

## Full regression gate

Linux CI: [Backend CI run 38183343137](https://github.com/WDP301-wedding/wedding-be/actions/runs/38183343137),
implementation source `a6e79d73c55ba58a49876f8b0440c29ae74b75cf`.
Both unchanged CI jobs pass on that exact implementation source:

- Empty PostgreSQL install: all **45 migrations** deploy successfully.
- Integration: **73 files / 403 tests pass**, no skips.
- Full suite: **222 files / 1,683 tests pass**, no skips.
- Full coverage: **97.44% lines / 93.61% branches**, 96.60% statements,
  98.53% functions; every included source file meets the existing 80% line/branch gates.
- Static, formatting, Prisma generation, **136 unit files / 1,241 tests**, **13
  contract files / 39 tests**, OpenAPI, production build and dependency-audit jobs pass.

The subsequent hand-off commit changes documentation/evidence only; its runtime
source files are identical to this pinned, fully validated implementation commit.

Full Windows fork attempts failed with native runner code `0xC0000409`, including
unchanged commercial/billing/media/idempotency suites. A thread-pool full attempt
also exited natively while running the unchanged billing HTTP suite. These runs
are **not successful gates**; their partial counts/coverage are not acceptance
metrics. The isolated cancellation-approval case and commercial suite pass without
changing their assertions. This failure signature is also recorded in earlier
repository evidence (`be01-05-commercial-foundations.md`, `booking-lifecycle.md`).
Linux CI runs the unchanged full test/coverage and PostgreSQL migration gates.

## Review and mutation

An independent read-only review found four required defects, all corrected and
verified: shared trigger referenced a Guest-only field when updating Groups;
completed Booking prematurely denied an otherwise valid invitation; the general
1 MiB parser intercepted the declared 5 MiB import path; name normalization lacked
full Unicode default case folding. A follow-up review found no additional required
GM-W1–W4 correctness/security defects. The planning contract now uses an explicit
interface rather than an application dependency on an infrastructure factory type.

Mutation experiment: invert `workspace.planRevision !== input.expectedRevision`
to `===`; the atomic planning regression fails because the valid request is rejected
before its expected provider failure. Restore the entire file byte-for-byte from
a saved copy; the planning regression passes again in the accepted Guest coverage
run. Review and test evidence are backend-only; no frontend/native acceptance gate
was introduced.

## Exact artifacts and readiness boundary

- Provider version: `guest-management@1.0.0`.
- OpenAPI 3.1.0 SHA-256:
  `4d162cdb766164e240a16c8bc53770a481cfa521491dae313f2971beba0cd63f`.
- Additive migration: `20261012010000_guest_management`; SHA-256
  `1eefac415e6418e5fdf2ce2b005b7755bc6b305310b182d1c1dfbe2e692bae9f`.
- Exact provider/owner source hashes and unchanged lockfile hash:
  [machine manifest](./guest-management-provider-manifest-2026-10-12.json).
- Schemas, examples, errors, authorization, import and credential integration:
  [backend hand-off](../../docs/guest-management-w1-w4.md).

Native local integration uses real Identity/Booking/Billing/Invitation readers and
transactions, with controlled fixture settlement/storage data. It does not prove
live payment settlement, provider delivery or production readiness. No paid image
generation, real-money payment, external email send, production migration, deployment
or PR merge was performed. Existing frontend repositories and user-owned prior
BE-17 merge evidence remain untouched.

GM-W5 stays pending: real downstream Seating/printing/event/invoice conformance,
Staff mode integration and automatic Notifications delivery with explicit recipient
and encrypted transient credentials. The separate RV backlog remains open according
to its existing target-specific evidence.
