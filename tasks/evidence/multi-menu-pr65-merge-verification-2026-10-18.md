# PR #65 merge and post-merge verification — 2026-10-18

The owner explicitly requested merge and verification. This local report records
the resulting immutable source, CI and automatic rollout without adding a new
source commit or changing the verified candidate.

## Merge and review

- PR: https://github.com/WDP301-wedding/wedding-be/pull/65
- Reviewed candidate: `9b1ecc56b6fd0e8d97d8d791bf8d75b89c28148c`.
- Before merge: mergeable/clean; no review submissions, no unresolved review
  threads (all threads fetched, no further page); both exact-head checks passed.
- Owner authorization follows the backend merge-policy amendment in
  `docs/backend-scope-2026-10-10.md`; another member's approval is not required.
- Draft changed to ready, then merged with an explicit candidate-SHA guard.
- Merge commit: `d9c41b7f12e89d62721f47242cd7345f17072b3c`.
- Merged at: `2026-10-18T03:27:16Z` / 10:27:16 Asia/Saigon.
- Parents: `9bbd251fa318abed8210e1b15aa72a825d7e9876` and the reviewed candidate.
- Fetched `origin/main` points to the merge commit. Its source tree is identical
  to the reviewed candidate (`git diff --exit-code HEAD origin/main` passes).

## CI on the actual merge commit

[Backend CI, push/main](https://github.com/WDP301-wedding/wedding-be/actions/runs/39093675408)
completed successfully on `d9c41b7`, independently of the earlier PR CI.

| Gate | Result |
| --- | --- |
| Formatting, lint, typecheck, production build | Passed |
| Unit tests | 1,461 passed, 162 files |
| Contract tests and generated OpenAPI | 59 passed, 20 files; consistency passed |
| Dependency audit | Passed, no high/critical advisories |
| Empty PostgreSQL migration deployment | All 61 migrations applied |
| PostgreSQL integration | 550 passed, 105 files |
| Full suite with coverage | 2,070 passed, 287 files |
| Coverage lines / branches | 97.56% / 93.51% |
| Existing per-file coverage thresholds | Passed unchanged |

Jobs: static `117575528506`, PostgreSQL/coverage `117575528313`.
Media native-provider (22 cases), FCM (8), Automation and populated historical
upgrade tests passed. Earlier Windows interruptions and the initial candidate's
P2022 failure remain preserved in prior evidence; they were not erased or
reclassified as proven infrastructure failures.

## Source artifact identity

SHA-256 was calculated from merge-commit Git blobs, preserving repository bytes.

- `openapi/openapi.json`:
  `19da7dafc991d316f7f048a58c6446deabb2e724edb3a49d55e4709ce14d04e2`.
- `prisma/migrations/20261018090000_booking_proposal_menus/migration.sql`:
  `257c50ce258f5bcbd204be188c0bbc23f8da6f2ac771d5415d62bd06605c196b`.

Both match the exact-head pre-merge verification. No applied migration was edited.

## Existing automatic Railway rollout and read-only HTTP verification

The already configured GitHub main/Wait-for-CI integration created deployment
`ba3a5b90-fa14-4ff6-9f30-5f364af57b6e` automatically after merge. No manual deploy,
configuration change or project-wide staged-change acceptance was issued.

- Project: `1c56721d-021a-442c-9e01-bb91abe73adb`.
- Environment: `08a2899c-b0d6-4200-a505-604965a4b3fc` (Railway label `production`;
  documented developer test environment, not production acceptance).
- Service: `0f70d648-8c59-48bd-84f3-29a86d2e2d38`.
- Deployment source: `main`, full merge SHA `d9c41b7f12e89d62721f47242cd7345f17072b3c`.
- Observed transition: WAITING for CI, BUILDING after CI success, then SUCCESS.
- Deployment log: `2026-10-18T03:36:16.368918137Z` applying migration
  `20261018090000_booking_proposal_menus`;
  `03:36:17.922004732Z` all migrations successfully applied.

Read-only HTTP checks at `2026-10-18T03:37:03.634Z`, origin
`https://wedding-be-production-e1dc.up.railway.app`:

| Endpoint | Result |
| --- | --- |
| `/health/live` | HTTP 200 |
| `/health/ready` | HTTP 200 |
| `/api/v1/openapi.json` | HTTP 200; parsed document deeply equals merge-commit artifact |

The live `BookingCreateBody` includes `menus`. Canonical JSON SHA-256 for both
live and merged documents is
`50691938bf51b1736ec409a88ee468c96e69d33d09d73053850adf5bd780edd8`.
Canonical JSON hashing is separate from the repository-byte hash above.

This proves the observed rollout, migration log and served contract. No booking
was created against shared data, and no paid generation, live notification or
real-money payment was invoked. Offline controlled-provider tests remain distinct
from live provider and complete business-journey acceptance.

## Workspace preservation

The pre-existing 37-line local PERF-13 addition in
`tasks/backend-revision-todo.md` remains uncommitted and preserved. Other existing
untracked performance/output evidence remains untouched. The checkout remains on
the feature branch; remote `main` and fetched `origin/main` are verified above.
Frontend repositories were not changed.
