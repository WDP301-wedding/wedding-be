# SPEC-11 backend candidate and go/no-go checkpoint

Date: 2026-10-13 (Asia/Saigon). Base revision:
`376435941e8e876e16c7caa07855d234dc65338d`.
Provider version: `BACKEND-RELEASE@3.0.0`.
Machine evidence: [candidate source/API/provider/coverage manifest](release-provider-manifest-2026-10-13.json)
and [local migration/recovery report](release-migration-recovery-local-2026-10-13.json).
Source state: combined, uncommitted workspace, including pre-existing SPEC-09/10
changes. Source content hashes identify the prepared candidate; the base commit
does not identify all working-tree code. No immutable release or deployment is claimed.

Requested order: REL-W1 → REL-W2 → REL-W3 → RV-21 → REL-W4 → REL-W5.
Accepted scope is backend-only under the 2026-10-10 owner requirements.

## Four evidence dimensions

| Dimension | Observed result |
| --- | --- |
| Implementation | Release environment/topology validator, exact-target gate evaluator, stable create-only seed port, native intake adapter/journey cases, local migration/runtime/recovery executable and candidate manifest CLI exist. |
| Offline/native verification | Native PostgreSQL owners and HTTP; controlled provider transports. Local empty/populated/repeated migrations, readiness outage/recovery, restart and disposable backup/restore pass. Details are in the machine manifest and local recovery report. |
| Configuration | Candidate CLI inspects workspace configuration separately; it never treats configured keys, a healthy endpoint or mocks as live proof. A separate staging deployment plan/recovery owner is still absent. |
| Live/staging verification | No new Railway deployment/provider operation occurred. Owner authorized preparation of separate staging and reserved approval of its concrete deployment. Current-source staging/worker/provider/recovery acceptance and RV-21 review remain pending. |

## Wave results and retained gates

| Wave | Result | Remaining acceptance |
| --- | --- | --- |
| REL-W1 | Developer implementation complete: strict config/manifest/gate checks and refusal proof. | This does not approve deployment configuration or close runtime gates. |
| REL-W2 | Partial: stable native intake seeds reject overwrite; native no-name Group/PDF/invoice and partial-name Staff/undo/invoice journeys pass. | Whole-journey persistent staging seed adapters/replay, accepted Notifications dependency and authorized provider acceptance. |
| REL-W3 | Partial: local mechanical rehearsal passes. | Dedicated staging, pinned-runtime CI/image, real hosted backup retention/encryption, target-specific recovery and named operator. |
| RV-21 | Candidate feature/API/source/evidence inventory prepared. | Owner-reviewed immutable release checkpoint after prerequisites. |
| REL-W4 | Candidate manifest and frontend integration checklist prepared. | Immutable accepted source/API/provider manifest; no working tree is published as a release artifact. |
| REL-W5 | NO_GO decision and recovery runbook prepared. | Accepted preceding waves and designated owner/recovery proof; no GO waiver. |

Only REL-W1 is eligible for a completed task checkbox at this checkpoint. Keep all
other requested acceptance tasks open. Historical completed scope remains intact.

## Commands and environments

Windows, static/local rehearsal Node 24.15.0, final native coverage Node 24.19.0,
npm 11.7.0, PostgreSQL 18.6. The repository/Dockerfile pins
Node 24.21.0 and npm 11.19.0; local proof does not substitute for that CI/image.
Database targets are newly created localhost disposable databases; no shared-data
retention, real-money payment or paid generation is executed.

- `npx vitest run src/modules/release-demo --coverage --coverage.include=src/modules/release-demo/** --coverage.reportsDirectory=test-results/release-coverage`: 22 tests / two files pass, both implementation files have 100% lines/branches. The existing per-file 80% thresholds are unchanged.
- `npm run release:journey`: 36 native owner/HTTP tests / two files pass, no skipped DB tests. This includes the existing no-name Group/printing/completion/zero-expense invoice acceptance and new partial-name assigned Staff/retry/undo/archive/money-invariance scenario.
- `npm run release:rehearsal`: pass. Report: `test-results/release-rehearsal/635e5e6c38704e0b9df3e8551cf1bf6f/report.json`; a redacted copy is retained with this evidence bundle. Synthetic erasure replay precedes restored-service startup. Hosted 30-day encryption and real privacy/settlement recovery remain unverified.
- `npm run release:manifest -- --output test-results/release/checkpoint-manifest.json`: expected NO_GO. It refuses missing/failing/wrong-source/API/target/origin/duplicate/future receipts, dirty source and incomplete prerequisites. The final evidence bundle carries the resulting candidate inventory.
- Review mutation: inverted the committed-source guard in an isolated private copy and ran its real policy suite. Two tests failed, including the intended dirty-source regression; the original source was never modified.
- Full native suite, final typecheck/lint/build, contract/API and dependency-audit outcomes are recorded in the accompanying machine manifest. The first global lint run found eight pre-existing async-without-await errors in Notifications/VNPay test doubles; replacements preserve resolved/rejected Promise behavior and never suppress checks.

The first broad fork run on Node 24.15.0 had a 30-second runtime-foundation timeout,
10 failed suites (mostly cleanup hooks / concurrent Prisma migration advisory lock),
and one Windows native-worker exit. These failures are retained rather than hidden.
The failed runtime test passed unchanged in isolation. Serializing the migration
lane with bundled Node 24.19.0 and the threads pool then passed **1,848 tests / 256
files, zero skipped/errors**, including full per-file coverage >=80%. Overall lines
are 97.51% and branches 93.44%. The exact command/result and coverage summary are
in the machine bundle. No timeout, coverage threshold or test assertion was weakened.
Pinned-runtime remote CI/image and staging remain separate pending evidence.

The concurrent scheduler regression also exposed an empty-update ORM upsert race:
two first scans/completions could collide on a primary key. Native PostgreSQL
createMany/skipDuplicates followed by reading the exact existing identity fixes
both paths. Ten native scheduler tests pass, including concurrent independent first
scans and once-only +12h completion; focused scheduler coverage is 100% lines and
97.05% branches. No migration or money/attendance formula was changed.

## Why other worktree evidence is not acceptance for this candidate

Ignored local records show a separate Notifications implementation at revision
`a424777a3b723982162604566e99bc5d1c89560e`, with Railway runtime/API/worker evidence.
That worktree uses migration names such as `20261012040000_notification_foundation`
and `20261012041000_notification_credentials`; the current workspace instead has
`20261012040000_notifications_automation` and
`20261012041000_notification_due_identity`. Its provider/API/source receipts cannot
close the current NTF/RV tasks. Do not rewrite applied migrations or deploy this
candidate's alternate migration lineage against the existing target DB.

The latest checklist has NTF-W1–W5 checked, while no current-source Notifications
acceptance/hand-off file is attached. Preserve those developer checkboxes and
record their evidence limitation separately; they are not live worker/provider
acceptance. Current native/full-coverage evidence verifies code/offline operation.
GM-W5 and RV-16 remain open; RV-21 remains open. The release evaluator still
requires exact-source staging/worker/provider receipts independently of checkboxes.
Historical live email/Storage/Gemini/VNPay evidence retains its original immutable
source and tested target and is neither deleted nor silently extended to new code.

## Prepared artifact and hand-off

The local backend staging archive excludes environment files, Git history, generated
Prisma output, dependencies, private logs and test results. Its exact archive/API/
source/migration hashes are recorded in the candidate manifest. It has not been
deployed and remains a workspace candidate. Before a concrete deployment request,
resolve source integration/acceptance and pass the immutable pinned-runtime gates.

See [API, seed, staging proposal, frontend checklist and recovery runbook](../../docs/backend-release-spec11.md).
Frontend delivery remains separately pending and is never reported as a completed
backend check. The full backend is **not complete**; the release decision is **NO_GO**.
