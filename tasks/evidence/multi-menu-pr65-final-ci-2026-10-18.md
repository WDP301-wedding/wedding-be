# PR #65 final test verification — 2026-10-18

Candidate: `9b1ecc56b6fd0e8d97d8d791bf8d75b89c28148c` on
`codex/multi-menu-proposals`, [draft PR #65](https://github.com/WDP301-wedding/wedding-be/pull/65).
This local follow-up records CI results without changing the verified candidate.
It supersedes earlier pending-CI/coverage statements for this exact candidate;
owner review, merge, deployment and live-provider readiness remain separate.

## Confirmed defect and correction

The initial candidate `b519cb8` failed complete integration CI with Prisma P2022
in seven historical-upgrade files. The current generated client selected the new
`BookingProposalSnapshot.menus` column against the deliberately older database
used during migration rehearsal. Full stack traces are retained in the failed
[first CI run](https://github.com/WDP301-wedding/wedding-be/actions/runs/39092504565).

Commit `9b1ecc5` restricts the shared historical fixture's lookup/update return
selection to the proposal ID it actually needs. Billing's byte-for-byte history
comparison preserves every old field while omitting the later menus field;
after migration it separately verifies menus is NULL. Ten tests across all seven
affected files passed locally before the correction was pushed. No runtime money,
authorization, applied migration, test timeout, assertion or coverage threshold
was weakened.

The original interrupted Windows Media/FCM/Automation failures remain historical
observations with no proven root cause. Complete local reproduction passes all
34 assertions, both without and with coverage. The three-file coverage diagnostic
does not meet MediaService's branch threshold because it omits the other tests;
it is not counted as full coverage acceptance. The complete CI result below is
the authoritative coverage proof. The overlapping-query pg/Prisma deprecation
warning occurs on passing runs too and was not hidden or treated as the cause.

## Exact-candidate CI

[Backend CI run 200](https://github.com/WDP301-wedding/wedding-be/actions/runs/39092983812)
completed successfully on the final candidate, after the fixture correction.
Ubuntu, pinned Node 24.21.0, disposable PostgreSQL 17, controlled providers.

| Gate | Result |
| --- | --- |
| Formatting, lint, typecheck, build | Passed |
| Unit tests | 1,461 passed, 162 files |
| Contract tests | 59 passed, 20 files |
| Generated OpenAPI consistency | Passed |
| Dependency audit | Passed, no high/critical advisories |
| Empty-database migration deployment | All 61 migrations passed |
| PostgreSQL integration | 550 passed, 105 files |
| Full-suite coverage | 2,070 passed, 287 files |
| Coverage lines / branches | 97.56% / 93.51% |
| Existing per-file 80% lines/branches thresholds | Passed unchanged |

Static job: `117573455824`; PostgreSQL/coverage job: `117573455944`.
The full coverage run includes successful Media (22 cases), FCM (8), Automation
(4), and all formerly failing populated-upgrade files. No skipped-test workaround
was used to obtain the final pass.

OpenAPI SHA-256:
`19da7dafc991d316f7f048a58c6446deabb2e724edb3a49d55e4709ce14d04e2`.
New forward migration SHA-256:
`257c50ce258f5bcbd204be188c0bbc23f8da6f2ac771d5415d62bd06605c196b`.

No merge, remote business-data migration, paid generation, live FCM/Storage call,
real-money operation or deployment was performed. Pre-existing local performance
backlog/evidence changes were preserved and excluded from the candidate commits.
