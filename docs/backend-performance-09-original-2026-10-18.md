# PERF-09 original acceptance verification — 2026-10-18

The owner reopens PERF-09 to complete its original criteria. The limited-scope
[decision](../tasks/evidence/perf09-owner-acceptance-2026-10-17.json) and
[earlier failed comparison](backend-performance-catalog-readonly-2026-10-17.md)
remain historical evidence. This candidate passes the original 1/20-item native
gates; exact-head CI, reviewed owner-authorized rollout and after probes remain
required before closing the canonical checklist.

## Change and correctness

The public Hall list previously reads the page, rechecks all selected Hall
identities and then loads media. A cursor adds another read. The Venue-owned
reader now captures cursor eligibility, an active Hall page and its attached HALL
media together in one parameterized statement. The existing signer still creates
new private URLs with the 900-second TTL for every request. Public fields, cursor
errors, lifecycle visibility, media ownership/order, deadline enrollment and
configuration remain unchanged; no cache, migration or provider interface is added.

Thirteen new PostgreSQL cases cover exact 1/20 plain/media pages at service and
HTTP boundaries, strict public DTOs, tied display order, cursor continuity/end,
missing/retired cursors, detached and wrong-resource media, repeated signing,
next-request retirement and a quoted configured schema. The blocked-read deadline
test uses the real media service and verifies no signing after timeout. The broad
run passes 159 tests including twelve new cases; the final run passes fourteen
including all thirteen new cases and the existing budget measurement. The union
is 160 focused tests, not their sum. Removing lifecycle or resource-type predicates
kills the corresponding regression; source is restored byte-for-byte.

Actual driver ceilings tighten from three to one for plain and rich catalog pages;
1/20 and cursor HTTP cases also use one command. Existing latency investigation
bands and all other ceilings remain unchanged. Local 40-ms-per-driver modeling
improves twenty-item plain/rich p95 about 97.4%; this is synthetic, not provider RTT.
EXPLAIN ANALYZE on a separate 5,000-Hall local clone uses the existing Hall and
media indexes, returning only 2/21 lookahead rows. The cursor condition is included
in the Hall index condition; no catalog-wide application load/slice remains.

## Authorized live fixture and method

The owner explicitly authorizes one temporary private schema, 41 synthetic Halls
(20 plain, 20 with media, one retired), twenty private PNGs totaling 1,920 bytes,
one additional connection from existing utility spare, and cleanup within 45 minutes.
The schema has RLS on both tables and no anon/authenticated usage. Exact enum
labels, defaults, checks and read indexes are retained. Public Analytics write
triggers are intentionally not cloned into synthetic read fixtures. No existing
public catalog or business row is inserted, changed or deleted.

All variants run in the same serving SFO container against the same real provider,
fixture and maximum-one read-only pool: pinned original modules from
`3c6e8984c547d92f25dc4959c44503321e5f5528`, deployed modules, and in-memory
candidate modules. This is native loopback HTTP, excluding public ingress. The
application Venue pool remains three; these measurements describe the authorized
single-connection experiment and do not establish multi-reader capacity.

A successful unmeasured pilot precedes one initial triplet plus twenty measured
triplets per case. Order reverses each round; samples are sequential, spaced
500 ms, capped at 25 seconds, with no retries or discarded measured samples.
Storage signing is inside HTTP timing. Body GETs are outside it; summed parallel
signing elapsed time is not critical-path attribution. Canonical comparison removes
only signed URL values and sorts object keys, retaining all other fields and order.

Nearest-rank p95 in ms, twenty measured samples per variant/case:

| Case               | Items | Assets | Original | Deployed | Candidate | Original gain | Incremental gain |
| ------------------ | ----: | -----: | -------: | -------: | --------: | ------------: | ---------------: |
| one-no-assets      |     1 |      0 |  473.391 |  474.352 |   160.025 |       66.196% |          66.265% |
| twenty-no-assets   |    20 |      0 | 6393.686 |  472.931 |   161.139 |       97.480% |          65.928% |
| one-with-assets    |     1 |      1 | 1002.822 | 1147.569 |   660.910 |       34.095% |          42.408% |
| twenty-with-assets |    20 |     20 | 6724.478 | 1941.171 |  1011.927 |       84.952% |          47.870% |

All 240 measured and twelve initial responses return 200 and all 84 triplets match
complete canonical DTOs. The four original-source gains exceed 30%. Original driver
commands are three for one item and 41 for twenty; deployed uses three plain/four
cursor-rich; candidate uses one throughout. Do not mix original and incremental gains.

The main campaign verifies 126 real Storage GETs plus 63 in its successful pilot,
all matching exact PNG sizes/checksums. Every rich response signs the expected
number of URLs at TTL900; first/last URL hashes differ. Expired one-second and
unsigned private-object controls are denied. Missing/retired/malformed cursors and
end-of-list behavior match across all variants. No twenty-item public-ingress or
production SLO/capacity claim is made.

## Public baseline, failures and cleanup

The existing public demo still has three Halls. All 84 before-rollout reads pass;
all 90 discovery/catalog/control operations correlate with the unchanged deployment.
This includes a preserved operator mistake: nonexistent management path returns
404, then the canonical management path returns 401. The eighty measured reads
are retained without rerun or removal. Client and backend timings remain separate
in the receipt; real Storage GETs are separate provider evidence.

All 32 selected business-table digests, fifteen public catalog-table digests and
61 migration checksums match. Runtime/source/image/configuration remain unchanged
during measurement. The owned schema, two tables/types, 41 Halls, twenty media
rows and twenty Storage objects are removed without CASCADE; all twenty deleted
object URLs are denied. The SSH key is revoked, reuse fails, and owned key files
are removed. Native pools/servers close; the isolated local cluster stops with no
test databases remaining. All 47 prior PERF-09 operator artifacts remain unchanged.

Preserve setup failures: invalid Storage purpose; missing test router factory and
normalized-name fixture; enum inference and schema-local enum lookup; unsuccessful
domain alias; constraint-trigger metadata classification; operator quoting errors;
and the public path control. The initial 5,000 business-Hall setup times out in
deferred Analytics COMMIT. Only that isolated local backend is cancelled and its
leftover database removed after verifying the dedicated loopback cluster. A separate
cloned-table read-plan fixture succeeds with constraints/indexes intact. None of
these failures is hidden or counted as a passed cohort.

Local typecheck, focused lint/format, production build, OpenAPI and five-axis
self-review pass. This does not claim independent review. The
[machine receipt](../tasks/evidence/perf09-original-verification-2026-10-18.json) preserves raw observations, hashes, failures and
cleanup. Exact-head CI and project-owner reviewed rollout remain release gates;
PERF-13 stays open and production **NO_GO** is unchanged.

Design references: PostgreSQL [CTE materialization](https://www.postgresql.org/docs/current/queries-with.html)
and Supabase [private Storage access](https://supabase.com/docs/guides/storage/security/access-control).
