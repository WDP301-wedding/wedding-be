# Review of uncommitted backend work — 2026-10-21

The original workspace is on `codex/invitation-backend-latency`, starting at
`563c7bb38ba2433d3571043c26e76528479e4ddf`. Its dirty status describes changes
relative to that old branch, not changes missing from the current project.
After fetching, current main is `220263177c31a9249bdf4838687161b5b6f9ae44`.
Preparation uses a separate managed worktree and preserves the original checkout.

The [per-file inventory](../tasks/evidence/uncommitted-review-2026-10-21.json)
records 86 modified/untracked files outside `output/`. Comparisons normalize CRLF
to LF, then compare the complete contents against current main.

| Group                                       | Decision                                | Reason                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 39 files identical to main                  | Already integrated; no duplicate patch  | Includes notification audience/inbox reads, catalog page/media batching, billing persistence, performance runner, stricter budgets and their tests/evidence.                              |
| 5 older source/config files                 | Retain current main                     | `.env.example`, `src/config/env.ts`, its tests, `booking-unit-of-work.ts`, and `payments-billing.providers.ts` contain accepted old changes but lack subsequent main safeguards/features. |
| 2 owner-scope files and the scope amendment | Integrate additively                    | The human supplied these instructions. Preserve current main's separate VNPay recovery amendment as well.                                                                                 |
| Prisma schema                               | Copy only two index declarations        | Copying the whole old schema would remove the private external-work and durable-image-job additions already deployed.                                                                     |
| 2 planning files                            | Append the PostgreSQL section only      | Preserve newer balance eligibility and durable AI-job tasks, plus existing history.                                                                                                       |
| 4 PostgreSQL candidate files                | Integrate after current-main validation | Forward index migration, native query-plan test, review notes and local measurement evidence.                                                                                             |
| 32 historical receipts                      | Preserve as dated documentation         | These are post-merge, rollout and investigation records. They do not add executable behavior or grant new provider/deployment acceptance.                                                 |
| `output/`                                   | Exclude from Git                        | Contains generated reports, binaries, raw logs, private fixture/configuration artifacts and local PostgreSQL data. Preserve locally.                                                      |

## Specific regression risks avoided

The local token policy change to 1,800 seconds is already on main through PR #77.
Copying the old config would remove `AI_IMAGE_JOBS_ENABLED` and its validation.
The shared billing-read fence is already on main through PR #73. Copying the old
unit of work would remove the newer `lockIdempotencyExecution` writer fence.
Copying the old payment composition would omit the balance-eligibility invoice
reader and provider-enabled facts. These older complete files are not safe patches
for current main; retain the current implementation.

No existing migration is edited, no feature or schema model is removed, and no
current application source file needs replacing for the index release. The main
dependency lockfile, public API and provider/runtime settings are retained.

## Historical evidence review

The 32 receipts total approximately 755 KB. Their Markdown/JSON is parsed and
screened for private-key blocks, GitHub/Supabase secret prefixes, credential-bearing
database URLs and sensitive named fields. The one flagged `authorization` value
is a Vietnamese human instruction, not a credential. No matching secret was found.
This screening is not a new independent re-execution of the old provider tests.
Request IDs, synthetic fixture IDs, source hashes and deployment identifiers remain
as technical correlation evidence. Historical pending/failed/NO_GO statements stay
dated and do not override subsequent task decisions.

The original dirty checkout, raw output and previously recorded failures remain
available for recovery. No reset, stash, bulk `git add .`, destructive database
cleanup, paid generation or real-money payment is part of this integration.

## Verification and rollout

Run current-main formatting, lint, typecheck, unit/contract, build, audit and native
PostgreSQL gates on the selected branch. Publish the candidate for exact-head CI;
deploy only the immutable Prisma migration chain after the release gate passes.
The inbox index migration is additive and keeps its 5-second lock / 60-second
statement limits. Hosted data preservation, index validity, migration checksums
and compatible read results are verified separately after applying it.
