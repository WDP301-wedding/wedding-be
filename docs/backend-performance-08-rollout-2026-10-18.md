# PERF-08 reviewed rollout and checklist closure — 2026-10-18

The owner authorizes merge, deployment, read-only verification and merging the
follow-up evidence/checklist after green CI: “Cho phép merge, triển khai, kiểm tra
và đóng PERF-08”. [PR #68](https://github.com/WDP301-wedding/wedding-be/pull/68)
merges reviewed head `81369e61c68870a7a57c9d307ef66be15e78d114` as `38c6433ce55a5733eff74b297a3f9d1375d154f5`.
The runtime acceptance passes; this documentation change records the canonical
PERF-08 closure. Historical verification notes keep their original pending status.

## Code, CI and deployed source

Both [exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39107116787) and [main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39107804177) pass
on their first attempt: 1,461 unit, 59 contract, 586 PostgreSQL integration tests
and the full 2,106-test coverage run. Format, lint, strict types, OpenAPI, production
build, immutable migrations and dependency audit pass. No thresholds are lowered.
The five-axis self-review has zero unresolved threads; no independent review is claimed.

Railway's sole active deployment `dcfff39c-1c18-4a38-98b7-15ab75e2a438` serves
source `38c6433ce55a5733eff74b297a3f9d1375d154f5`, image `sha256:21c946494ca273f22e82a9d948c1db4270789d718b555854a2c74ea8e2599683`.
The previous deployment stops. All three measured candidate source hashes match
the merged source; the merge tree equals the reviewed PR tree. Identity, HTTP DTOs,
notification foundation, migrations, OpenAPI, dependencies and deployment controls
retain their earlier hashes. Pool, region, provider settings, diagnostics and
deadline settings remain unchanged.

## Read-only after checks

Health live/ready and exact OpenAPI return 200. Anonymous inbox and unread return 401. Two existing accounts complete 84 successful inbox/unread reads (one initial
plus twenty steady per role/endpoint). Complete response hashes match the native
acceptance, and private response headers remain no-store/no-referrer. Both sessions
log out successfully; subsequent Identity, inbox and unread reuse returns 401.
All 99 recorded operations correlate with the new deployment's request logs.

Twenty steady samples per case retain all tails, with nearest-rank p95 in ms:

| Case                 | Backend before | Backend after | Client before | Client after |
| -------------------- | -------------: | ------------: | ------------: | -----------: |
| manager-inbox-empty  |       1553.553 |      1127.052 |      1782.568 |     1357.248 |
| manager-unread-empty |       1702.095 |       945.637 |      1930.471 |     1194.399 |
| couple-inbox-empty   |       2138.155 |       966.470 |      2376.690 |     1194.407 |
| couple-unread-empty  |       1688.070 |      1267.278 |      1932.120 |     1493.677 |

The public before cohort is the preceding deployed optimization; it is separate
from the original pinned-source native comparison. Client and backend observations
remain separate. These cohorts do not establish shared-load capacity, holder
attribution or a production SLO; PERF-13 remains open.
Incremental public backend p95 improves only 27.453% for Manager inbox and 24.927%
for Couple unread; their client gains are 23.860% and 22.692%. These below-30%
public results remain explicit PERF-13 evidence, not an all-case public target pass.

The controlled same-container comparison against original `3c6e898` passes the
30% target: inbox p95 improves 49.607–49.843%, unread 42.636–43.138%, with four
driver commands. Incremental unread improvement versus the preceding deployed
version is only 19.643–19.986%; no 30% claim is made for that comparison. Both live
inboxes are empty. Populated 0/1/20, tied-order/cursor/schema and permission-race
coverage remains isolated PostgreSQL evidence: 71 focused tests pass, including
20 new cases, and all 14 final-check-removal mutations fail as intended.

## Preservation and cleanup

All 32 scoped table digests and 61 applied migration checksums match before and
after rollout. No notification, read flag, provider delivery or business fixture
is changed. Authentication/session lifecycle is the recorded operational exception.
The temporary SSH key is already revoked, reuse fails and owned key files are
removed; no replacement key is created for rollout. Native pools/servers close.
The isolated local cluster is stopped with zero test databases remaining.
All 77 originally sealed operator artifacts retain their checksums.

The [runtime receipt](../tasks/evidence/perf08-pr68-rollout-2026-10-18.json),
[exact-head CI receipt](../tasks/evidence/perf08-pr68-ci-2026-10-18.json) and
[original verification](backend-performance-08-verification-2026-10-18.md) preserve
sources, raw observations, prior failures, visibility/revocation tests and limits.
Rollback is the preceding reviewed source/image and requires no schema rewrite.
This closes PERF-08 only. Provider acceptance and production **NO_GO** are unchanged.
