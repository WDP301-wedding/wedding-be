# Initial proposal multi-menu backend extension — 2026-10-18

Authorization: owner requested multiple menus with a separate table quantity at
initial proposal creation. Backend only. Branch `codex/multi-menu-proposals`,
base `32a25a8bf0eed993b3de2fe73e116e38698cdb65`. Pre-existing local performance
backlog/evidence changes are unrelated and preserved.

## Implementation

- Manager-only `POST /api/v1/bookings` accepts 1–50 menu versions with a positive
  quantity each, at most 500 total tables. Legacy single-menu input still works;
  mixed input, duplicates, fractional quantities and client prices are rejected.
- Every menu is resolved through the existing exact-version Venue reader. The
  immutable proposal retains version/name/description/price/quantity/line total.
  Checked integer arithmetic combines all lines and rounds the initial 30% estimate
  once after summing. Planning headcount is independent.
- `GET .../proposal` returns all `proposal.menus`; `proposal.menu` remains the
  first-menu compatibility preview. Owning restricted Couple can read; initial
  creation remains Manager-only. Commercial approvals/deposit/appendix authorities
  are unchanged. See [frontend contract](../../docs/booking-multi-menu-proposals.md).
- Forward migration `20261018090000_booking_proposal_menus` adds nullable JSONB
  retained facts and checks per-line arithmetic/aggregate bounds. NULL historical
  snapshots retain the old multiplication constraint and amounts. No backfill or
  applied migration edit occurs; the existing immutability trigger protects menus.
- No frontend source, provider configuration, external request or deployment was
  changed. Testing uses disposable databases on local PostgreSQL only. This is
  implementation/native evidence, not live provider or deployment readiness.

## Verification history

RED: the new schema/domain cases failed against the original code (4 failures),
then passed after implementation. Review mutation changed the aggregate request
limit from 500 to 5000: the oversized-total test failed, and the original source
was restored in `finally`.

The first native attempt could not connect because the local demo server was
stopped. `npm run demo:db:start` restarted only the local server. The verification
wrapper creates fresh random test databases, deploys migrations, and drops only
those databases after tests; it does not migrate/reset the local demo database.

Native RED exposed the legacy database constraint multiplying one menu price by
all tables; the new forward migration replaces it with per-line/aggregate checks
while preserving the historical NULL case. A test expectation was corrected to
the existing 422 `IDEMPOTENCY_KEY_REUSED` contract, rather than changing middleware.
An OpenAPI assertion was corrected to inspect the registered component schemas,
because operation schemas use `$ref`.

On the host Node 24.15/fork runner, all six native assertions passed but teardown
timed out. This failed run is not acceptance. The final focused run uses the
repository-pinned Node 24.21.0 and `--pool=threads`: **6/6 tests in 2/2 files pass**,
including clean teardown. Changing both runner and runtime does not establish
which caused the earlier teardown problem.

```text
output/node-v24.21.0-win-x64/node.exe scripts/staff-operations.verify.mjs
  tests/integration/booking-lifecycle/runtime.test.ts
  tests/integration/booking-lifecycle/upgrade.test.ts
  --maxWorkers=1 --pool=threads
```

The focused native run applies all 61 migrations. It proves persisted 20/40-menu
quantities, server totals, Manager-only creation, restricted Couple read, foreign
read denial, exact replay, changed-payload rejection, one Booking, SQL total/count
validation, immutable menu history and legacy upgrade with `menus = NULL`.
Migration SHA-256:
`257c50ce258f5bcbd204be188c0bbc23f8da6f2ac771d5415d62bd06605c196b`.

## Final gates

- Pinned Node 24.21.0 `npm run typecheck`, `npm run build`: passed.
- `npm run test:contract -- --maxWorkers=1 --pool=threads`: 59 tests in 20 files passed.
- `npm run api:generate` and `npm run api:check`: passed. OpenAPI SHA-256:
  `19da7dafc991d316f7f048a58c6446deabb2e724edb3a49d55e4709ce14d04e2`.
  The final artifact also expresses legacy-versus-array exclusivity as `oneOf`;
  the focused schema/OpenAPI regression has 21 passing tests in two files.
- A broad two-worker coverage attempt, concurrent with static checks, encountered
  Media/FCM timeouts and was stopped for diagnosis. The failing Media named case
  passed when isolated (1 passed, 21 filtered out); that diagnostic is not the full
  Media suite. A one-worker full coverage attempt also reported a failure in
  `notification-automation.test.ts`, `native due jobs with Android=false`, and was
  stopped for isolation. The exact named case passed separately (1 passed, 3
  filtered out), including clean teardown. These bounded diagnostic passes do not
  turn either interrupted broad run into a pass, and no root cause is claimed.
  Test bodies and thresholds are unchanged. Whole-repository coverage remains an
  open verification gate; local resource/timing variability requires a clean CI
  or otherwise stable complete run before claiming broad acceptance.
- Tracked-source lint passed: **679 files, zero errors and zero warnings** via
  the installed ESLint API and repository configuration. Plain `npm run lint`
  also traverses pre-existing untracked `output/` artifacts; that broad attempt
  was stopped without editing lint rules or ignoring tracked source files.
- Feature-specific coverage: **277 tests in 39 files passed**, all 61 migrations
  applied to disposable local PostgreSQL, clean teardown. Aggregate changed-file
  coverage: **97.62% lines, 95.23% branches**. Every changed runtime file passed
  the existing per-file 80% lines/branches thresholds; no threshold was changed.
  Command: pinned Node `scripts/staff-operations.verify.mjs
  src/modules/booking-lifecycle tests/integration/booking-lifecycle/runtime.test.ts
  tests/integration/booking-lifecycle/upgrade.test.ts --maxWorkers=1 --pool=threads
  --coverage`, with `--coverage.include` for each of the nine changed runtime
  TypeScript files and a dedicated output report directory. This is bounded
  changed-file coverage, not whole-repository coverage.
- Formatting of changed source/documents and `git diff --check`: passed.
- Subsequent complete-file verification of Media/FCM/Automation: **34/34 tests
  passed**, zero skipped and clean teardown. See
  [the diagnostic record](media-notifications-test-verification-2026-10-18.md).
- Whole-repository coverage remains pending, so BE-18 acceptance stays open even
  after these feature checks pass. The candidate will use a draft PR for Linux
  CI; no merge, remote migration or deployment is authorized by test verification.
