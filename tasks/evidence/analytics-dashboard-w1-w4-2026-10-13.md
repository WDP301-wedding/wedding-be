# SPEC-10 ANL-W1 → ANL-W4 acceptance, 2026-10-13

Backend-only developer evidence. The starting checkout contained unfinished
SPEC-09 changes on `codex/notifications-automation`; those changes were preserved.
This evidence describes the tested combined workspace, not a deployment, a clean
standalone Git commit, external-provider success or production readiness.

## Acceptance matrix

| Task | Implementation/evidence |
| --- | --- |
| ANL-W1 | Strict owner DTOs and additive immutable feeds; separate contract/approved appendix/finalized expenses/latest invoice aggregates; Billing cash/outstanding/credit truth; immutable multi-menu/service versions; independent planning/list/mode-aware nullable check-ins; no RSVP/whole-event inference |
| ANL-W2 | Commit-ordered per-owner fences; paged staging; duplicate/older suppression; source-error rollback; deterministic shadow rebuild and atomic generation switch; publication CAS/race proof |
| ANL-W3 | Five mounted Manager reports, authorized rebuild and aggregate JSON export; strict dates/filters/cursors; 1–366-day and 1–100 page bounds; source-specific freshness; privacy/RBAC/revocation tests; bounded projection reads |
| ANL-W4 | Deterministic unit/contract fixtures, real PostgreSQL owner/API/commerce acceptance, forward empty/populated migrations, exact OpenAPI/source manifest and frontend hand-off |

Code/commands were executed locally on Windows, Node 24.15.0 and the bundled
Node 24.19.0 for stable native verification, PostgreSQL 18.6.
The dedicated cluster is bound to `127.0.0.1:55441`, created specifically for this
request; test fixtures use UUID-suffixed disposable databases. No existing/shared
cluster, sibling frontend repository, paid image generation or live payment was used.

## Verification record

Final scoped acceptance: **98 tests / 11 files pass**, no skipped tests or unhandled
errors. Every one of the 21 SPEC-10 implementation/provider files (including
`server.ts`) clears unchanged per-file lines/branches >=80%; totals are **96.69%
lines / 93.99% branches**. Source/HTTP/provider/money/upgrade/scale cases all run
against disposable PostgreSQL. A 10,050-row unrelated synthetic projection history
proves narrow/empty queries succeed and matching broad queries return the declared
422 bound. The scale fixture writes projection rows only, not domain or ledger facts.

Command: bundled `node.exe node_modules/vitest/vitest.mjs run --config
test-results/analytics-vitest.config.ts tests/integration/analytics-dashboard.test.ts
tests/integration/analytics-upgrade.test.ts tests/integration/commercial-contracts-api.test.ts
src/modules/analytics-dashboard src/core/reporting src/core/http/lifecycle.test.ts
tests/integration/security.test.ts tests/contract/analytics-openapi.test.ts
--maxWorkers=1 --testTimeout=60000 --hookTimeout=60000 --coverage`.
The temporary scoped config inherits the checked-in coverage settings/thresholds
and lists SPEC-10 files explicitly; it does not change the repository quality bar.
Ignored logs: `test-results/analytics-scope-final.log` and
`test-results/analytics-scope-coverage/coverage-summary.json`.

Final static/publication gates pass: `npm run typecheck`, `npm run lint`,
`npm run build`, `npm run test:contract` (**44 tests / 17 files**),
`npm run api:generate`, `npm run api:check`, changed-file Prettier and
`git diff --check`. The final startup test-only typing/spy repair was separately
rechecked (**25 tests pass**). OpenAPI SHA-256 is
`8cb607c2149d35e6ae0dbb4626a42e795c523b7322fbc97b8f78dfd882a57586`.
The manifest's 33 code/API/migration hashes were revalidated without mismatches.
The dedicated test cluster was stopped after verification; its local evidence remains.

The broad native run on the immediately preceding source passed **252 files /
1,797 tests** with no skipped tests/errors, using bundled Node, `--coverage
--maxWorkers=1 --testTimeout=60000 --hookTimeout=60000`. Overall lines 97.30% /
branches 92.68%, but its command exits 1 because per-file coverage finds unfinished
SPEC-09 branches below 80% (plus then-uncovered export/startup branches). The final
SPEC-10 scoped run covers those export/startup paths and the final query changes;
the remaining 10 pre-existing SPEC-09 files are still a whole-workspace coverage
gate. Notifications is explicitly independent of complete analytics acceptance
(SPEC-10 Section 8); this work does not tick NTF/RV/REL tasks or waive that release
gate. Native runner wait/cleanup budgets are 60 seconds; production transaction/
request deadlines and semantic/performance assertions are unchanged.

- TDD red: `npm test -- src/modules/analytics-dashboard/domain/metrics.test.ts`
  failed before implementation because `metrics.js` did not exist.
- Initial green: four money/timezone/attendance formula tests passed.
- Source/projector tests cover duplicates/out-of-order records, later-page failures,
  fence mismatch, cursor cycle, missing sources, failed and deterministic rebuilds.
- Real native source/HTTP tests cover five private reports, current Manager denial,
  role revocation, no names/NONE, named-only enable/zero/check-in/retry/undo,
  Group rename/archive history, safe output, fixed source fences, generation races,
  immutable-feed rollback and audited rebuild/export.
- Real commercial API case creates/approves a full contract, records a controlled
  deposit, submits and mutually approves a service appendix, excludes draft expense,
  finalizes/replays invoice exactly once, compares Billing totals and deterministic
  rebuild, and confirms no second PRINT_ORDER obligation.
- Upgrade test populates canonical owner records before the analytics migrations,
  verifies backfill and preserves existing Booking reporting evidence. Empty
  `prisma migrate deploy` initially passed 55 migrations; the final 56-migration
  empty/native fixture plus populated-upgrade replay includes the event-query index.
- [API and operational hand-off](../../docs/analytics-dashboard-w1-w4.md).
- [Exact source/API/provider manifest](analytics-dashboard-provider-manifest-2026-10-13.json).

## Repairs and historical unsuccessful run

The first full coverage run used default worker concurrency on a nearly full C:
drive and returned 206 passed/44 failed files, 1,750 passed/25 failed/7 skipped
tests, with a Windows worker crash and cleanup/CLI timeouts. This run is retained
in ignored `test-results/analytics-full-coverage.log`; it is not a passing gate.

Diagnosis also found genuine pre-existing unfinished-workspace mismatches:
Seating emitted `PLANNING_HEADCOUNT_CHANGED` while its persisted CHECK constraint
rejected it; the VNPay test counted all previously settled deposits across fixtures;
minimal configuration expectations omitted new Notifications defaults; startup mocks
omitted new runtime/provider boundaries. Repairs preserve the quality thresholds,
scope the exact-once settlement assertion to its own payment, update strict expected
defaults/composition mocks, and add the forward constraint migration. No historical
checklist or applied migration was rewritten. The lower-concurrency final run is
recorded separately. The successful native run uses explicit 60-second runner
wait/cleanup budgets without changing application deadlines, assertion semantics,
skips or coverage thresholds.

Manual review covered correctness, source ownership, authorization/minimum data,
bounded reads and recovery. It added SQL filtering before the row budget,
common committed source fences, a calendar-end regression, UUID normalization,
cumulative settled/refunded fields, complete worker scope paging and startup
cleanup tests. This is an agent review, not independent team-member approval.

## Remaining release boundaries

Venue availability before the first observed catalog snapshot remains explicitly
unknown. Frontend implementation, remote Linux CI, deployment, actual Notifications
worker/provider evidence and owner release/recovery review are separate. Existing
RV/GM/NTF/REL checkboxes and prior evidence are not closed by this analytics work.
There was no external-provider run or production-readiness claim.
