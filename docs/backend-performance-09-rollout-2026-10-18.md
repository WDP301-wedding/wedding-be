# PERF-09 original-criteria rollout closure — 2026-10-18

The owner authorizes PR #70 merge, automatic Railway deployment, read-only catalog,
signed-URL and scoped-data verification, and merging the evidence/checklist after
green CI: “Cho phép merge, triển khai, kiểm tra và đóng PERF-09”.
[PR #70](https://github.com/WDP301-wedding/wedding-be/pull/70) merges head
`4f945d6c9966c018a7117c0a9a427baf814996fc` as `14aebab69e28982dbeece7c5dc4da3dc5b645ea1`.
The original-gate comparison and runtime checks pass. This documentation change
records canonical completion under the original criteria; the earlier limited-scope
owner exception and failed cohorts remain historical evidence.

## Original criteria and code

Actual 1/20 plain/media pages share one bounded Venue-owned statement and still
sign fresh URLs at TTL900. Strict public DTOs, invalid/end/tied cursors, lifecycle,
media ownership/order, configured schema and read deadlines stay intact. No cache,
API, migration, pool, region or provider configuration change is introduced.

Twenty alternating matched triplets per case compare original `3c6e898`, deployed
and candidate modules on the same max-one read-only pool and real isolated fixture
inside the SFO container. The serving application's Venue pool remains three.
Nearest-rank p95, ms; twenty measured samples per variant/case:

| Case               | Original | Candidate | Reduction |
| ------------------ | -------: | --------: | --------: |
| one-no-assets      |  473.391 |   160.025 |   66.196% |
| twenty-no-assets   | 6393.686 |   161.139 |   97.480% |
| one-with-assets    | 1002.822 |   660.910 |   34.095% |
| twenty-with-assets | 6724.478 |  1011.927 |   84.952% |

All four original targets exceed 30%; all240 measured/12 initial responses and
84 triplet comparisons match. Driver work is one command for 1/20 plain/rich pages.
Real signing stays inside timings; 126 main/63 successful-pilot checksum-verified
Storage body GETs remain outside. Freshness, expired/unsigned URL and cursor
controls pass. Indexed 2/21-row lookahead is separately confirmed on 5,000 local
cloned Halls. The 160 distinct focused tests include 13 new read cases; both targeted
predicate-removal mutations fail as expected and source is restored.

This is real-provider native loopback HTTP on an isolated 41-Hall/20-object fixture,
excluding public ingress. It is not a multi-reader capacity or production SLO claim.
Original and incremental deployed gains remain separate in the verification receipt.

## Reviewed rollout and public checks

Both [PR-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39111634444) and [main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39112412854) pass on
their first attempt: 1,461 unit, 59 contract, 599 PostgreSQL integration tests and the
full 2,119-test coverage run. Format, lint, strict types, OpenAPI, production build,
immutable migrations and dependency audit pass without lowering any gate. Five-axis
self-review has zero unresolved threads; no independent reviewer is claimed.

Railway's sole active deployment `fcfb17ed-f14b-4a6c-bb3c-f330616e7616` serves
source `14aebab69e28982dbeece7c5dc4da3dc5b645ea1`, image `sha256:2236f991eebb147e6a31d3000f0cc422fdc987b0b335e22e777365ebc5a72285`.
The prior deployment stops. Its merge tree equals the reviewed head tree, and all
three measured candidate source hashes match. Shared HTTP/Storage/database code,
migrations, OpenAPI, dependencies and deployment controls remain unchanged.

Health live/ready and exact OpenAPI return 200; anonymous catalog management returns 401. All 84 after-rollout public reads match complete canonical before facts, including
TTL900 and media order. The existing public catalog still has three Halls, not 20.
All 95 discovery/read/control/smoke operations correlate with the new deployment logs.
Four cohort and two freshness Storage GETs return exact retained PNG bytes/checksum;
first/last public URLs differ. A newly minted one-second URL expires and unsigned
private-object access is denied. No authenticated session is created.

Public before/after nearest-rank p95, ms; twenty steady reads per case:

| Case            | Items | Backend before | Backend after | Client before | Client after |
| --------------- | ----: | -------------: | ------------: | ------------: | -----------: |
| one-no-assets   |     1 |        472.322 |       140.891 |       744.306 |      392.995 |
| one-real-asset  |     1 |       1146.471 |       638.643 |      1379.939 |      875.911 |
| page-no-assets  |     2 |        469.433 |       140.881 |       715.426 |      717.634 |
| page-real-asset |     3 |        992.110 |       643.687 |      1241.120 |      882.033 |

These public cohorts compare the preceding deployed optimization with this rollout;
they are separate from the original-source native target. Every sample and tail is
retained, with client/backend durations separate. PERF-13 keeps capacity, attribution
and broader repeat/SLO work; these observations do not close it.
Public client p95 for two plain Halls worsens 0.309%; the three-Hall rich-page
client improvement is only 28.933%, below 30%. Both remain explicit PERF-13
evidence without assigning a cause or discarding a tail sample.

## Preservation and closure

All 32 scoped business and 15 public catalog digests, 61 migration checksums and all
configuration/control fingerprints match before/after rollout. No existing public
catalog/business row changes. The original owned schema, two tables/types, 41 Hall,
20 media rows and 20 tiny PNG objects were already removed; deleted URLs are denied.
The original key is revoked and reuse denied; no replacement fixture/key is created.
Native pools/servers close; the dedicated local cluster is stopped with no test DBs.
All 87 originally sealed artifacts and all 47 older PERF-09 artifacts stay unchanged.

The [runtime receipt](../tasks/evidence/perf09-pr70-rollout-2026-10-18.json),
[exact-head CI receipt](../tasks/evidence/perf09-pr70-ci-2026-10-18.json) and
[original verification](backend-performance-09-original-2026-10-18.md) retain raw
samples, source hashes, setup failures, corrected public-path control, local
benchmark timeout/recovery and cleanup. Historical pending statuses are superseded
by this reviewed runtime closure, not rewritten. Rollback uses the preceding
reviewed source/image, with no schema rewrite. PERF-09 is complete under its
original criteria. PERF-13 remains open; provider acceptance and production
**NO_GO** remain unchanged.
