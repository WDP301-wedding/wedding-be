# PERF-09 read-only catalog verification — 2026-10-17

Status: **PERF-09 closed by explicit owner acceptance of limited scope** on
2026-10-17, not by passing every original performance gate. The owner accepts the
existing read-only 1–3 Hall evidence without a twenty-item live measurement.
No measured cohort reaches the original 30% p95 target; that result is unchanged.
Do not treat a `limit=20` request returning three items as twenty-item evidence.
Production remains `NO_GO`.

[Machine evidence and operator-artifact hashes](../tasks/evidence/perf09-catalog-readonly-2026-10-17.json)
retain every measured cohort, the unmeasured pilot, provider probes and cleanup.
That immutable receipt records the initial OPEN decision. The later
[owner acceptance](../tasks/evidence/perf09-owner-acceptance-2026-10-17.json)
supersedes its task status only, not its measurements, limitations or hashes.

## PR #58 publication and CI recovery

[PR #58](https://github.com/WDP301-wedding/wedding-be/pull/58) is merged at
`6a7722bca0ff0e06a0b151c250478b38ace6b0eb` after reviewed head
`fb3db28fe5878869f7052e9d74bd2c6511894c5d` passes both required CI jobs.
[Exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39004306507)
and [main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39004857351)
each pass the full **2,002 tests**, including PostgreSQL migrations, integration
and unchanged per-file coverage gates. Dependency audit reports zero vulnerabilities.

The recovery changes only the PostgreSQL image source to Google's official Docker
Hub cache and pins the exact digest used by the preceding successful CI. It does
not skip tests, raise timeouts, reduce coverage or change the database version.
The original three ECR rate-limit failures before checkout/tests remain preserved
in the [registry recovery receipt](../tasks/evidence/ci-registry-recovery-2026-10-17.json).
The contract rejects a weakened `continue-on-error` gate in a local mutation check.

Deployment `387ee7d4-1f43-45de-b45b-b97dfdd0f137` serves this merge on one SFO
replica, with unchanged application image
`sha256:54861ef48762e114b26b54f8fcef1a7f7169b9c22c1520f89b9be551da32f99a`.
The prior deployment drains before measurement. Analytics acceptance and its
preserved failures remain unchanged. At measurement time PERF-01/02/10/12 were
the four closed tasks; the later owner decision adds PERF-09 as owner-accepted.

## Measurement boundary

There are **three active Halls**, two without media and one with the retained
237-byte PNG in real Supabase Storage. No Hall, media, booking, contract, payment,
audit or migration is created, modified or deleted by this campaign. No login,
upload, paid generation, production payment, region move or deadline rollout runs.
The normal application scheduler remains enabled and may maintain derived data.

The owner authorizes a separate temporary SSH key. Native comparison runs two
isolated loopback Express routers inside the serving container, not through public
Railway ingress. Three immutable baseline modules from
`3c6e8984c547d92f25dc4959c44503321e5f5528` are transpiled and imported in memory;
the current variant imports the deployed modules. The shared Venue service is
unchanged from that baseline. No old whole application is deployed, remote worker
file written, startup command changed or baseline HTTP switch exposed.

Both variants use the same real database, Storage provider and one additional
max-three pool, with acquire 2,000 ms and idle 60,000 ms unchanged. That native
connection requires `default_transaction_read_only=on`; Storage put/delete and
non-GET/non-Hall routes are forbidden. Diagnostics apply only to this native pool,
not the serving application's general diagnostics flag. One serving process has
a maximum of 25 application connections; adding 3 native and 10 reserve gives 38
against capacity 60. The declared two-process budget remains 2 × 25 + 10 = 60;
no second full application process or deployment overlap runs during measurement.

A separate unmeasured pilot and campaign pair zero precede **twenty alternating
matched pairs per case**: 160 measured samples across eighty comparisons. There
is one native HTTP sample at a time, a 25-second observation cap, and no retry or
post-hoc removal of neutral/regressing samples. Canonical comparisons remove only
the signed URL, retaining IDs, order, cursor, media ownership and 900-second TTL.
Actual Storage signing is inside each native timing; provider body GETs are outside.
Current public HTTP cohorts are independent observations, not baseline HTTP gains.

## Native result

P95 uses nearest rank (the nineteenth sorted sample of twenty). Times are ms.

| Returned items        | Assets         | Baseline p95 | Current p95 | P95 reduction | Actual driver commands |
| --------------------- | -------------- | -----------: | ----------: | ------------: | ---------------------- |
| 1                     | None           |      463.859 |     462.962 |        0.193% | 3 → 3                  |
| 1, cursor-selected    | One real asset |    1,008.966 |     846.581 |       16.094% | 3 → 4                  |
| 2                     | None           |      465.455 |     462.447 |        0.646% | 5 → 3                  |
| 3, requested limit 20 | One real asset |    1,020.590 |   1,022.222 |   **−0.160%** | 7 → 3                  |

All 160 measured native samples return 200, all eighty pairs match canonical
facts, and database diagnostics record no query errors. Fewer commands do not
establish lower wall latency: the baseline overlaps per-item reads in its warmed
three-connection pool, whereas the current one-item cursor path adds a cursor
lookup. Actual Storage latency also varies. No causal speed claim is made from
the 16.094% single-asset observation. **No cohort meets the 30% p95 target.**

## Public HTTP and provider checks

All **84 public catalog reads return 200**: twenty measured reads plus one
initial read for each of the four cases. Eighty-eight catalog/management requests,
including expected-denial controls, each match one exact-deployment completion
log. These are serial current-version observations, not concurrent-load evidence.

| Returned items        | Assets         | Measured reads | Client p95 ms | Backend p95 ms |
| --------------------- | -------------- | -------------: | ------------: | -------------: |
| 1                     | None           |             20 |       693.537 |        462.306 |
| 1, cursor-selected    | One real asset |             20 |     1,389.016 |      1,166.369 |
| 2                     | None           |             20 |       698.508 |        461.374 |
| 3, requested limit 20 | One real asset |             20 |     1,227.458 |        993.264 |

Forty native and twenty operator-side real signed Storage GETs all return 200,
the same 237 bytes and checksum
`7dfc8d5e2dcb1acb6556bf9e4e237d19385f7d3bf744ccbc6488be9406bc575d`.
URLs are freshly signed per read with the normal 900-second TTL; the first and
last public signed URLs differ. Unsigned private-bucket access and an expired
one-second control URL return 400. Malformed/missing cursors return 422; the
final cursor returns an empty page with null next cursor. Anonymous management
access returns 401. No authenticated session or role fixture is created; prior
Manager/Couple authorization evidence is preserved, not labelled a fresh repeat.

## Preservation and cleanup

The dedicated PERF-09 key is revoked, subsequent SSH transport is denied, and
only its owned discovery/public/private files are removed. Both isolated servers
and the native Prisma pool close before public HTTP measurement. No remote file
or service startup modification needs restoration.

Before/after catalog inventory and native Hall/media digests match. The fifteen
original business-table digests are unchanged, all sixty migration checksums
match, 145 public tables remain, and the historical Staff fixture has zero
check-ins. All ninety-six retained Analytics operator-artifact hashes and both
Analytics evidence receipts remain byte-identical.

The serving commit, image, one-SFO topology, pool limits, provider configuration
and raw OpenAPI artifact hash remain unchanged. Analytics diagnostics remain
unset; general DB diagnostics and safe-read deadlines stay off. No runtime
optimization, public cache, migration or provider write is added. Nine local
operator-harness tests pass; these are separate from the application's 2,002-test
exact-head/main CI evidence, not a claim that the new operator harness ran in CI.

The offline evidence publisher initially rejects its own private-key-header
detection literal. That false positive is retained, reproduced by a failing
regression, and corrected to identify an actual line-start key block. Private-key
and signed-URL rejection tests remain green. No live cohort is rerun or removed
to recover publication.

## Original unmet gates — preserved

The initial decision kept PERF-09 unchecked. This campaign cannot establish twenty returned items,
twenty media-rich resources, large-catalog scan cost, saturation behavior or a
thirty-percent live p95 improvement. There is no retired Hall in this fixture;
retirement/publication transitions are not manufactured under read-only authority.
Existing full-CI contract/native tests remain separate evidence for those behaviors.

Do not add a public cache, enlarge pools, extend timeouts or rewrite the original
target to turn this result green. Any future representative twenty-item campaign
needs separate authorization. No further fixture or optimization change is included.

## Owner acceptance and next priority

After reviewing the unmet gates, the owner explicitly says:
“Có và hãy coi như PERF-09 đã hoàn tất dù chưa giữ phép đo 20 item.” This authorizes
commit, report PR and merge after exact-head CI/review, and closes PERF-09 in the
accepted limited demo scope. It does not establish twenty-item behavior, a 30%
latency improvement, saturation capacity, all-API improvement or production readiness.
Original task targets and the immutable initial OPEN receipt remain available.

The checklist now has five closed tasks: PERF-01/02/09/10/12; PERF-09 is distinctly
owner-accepted rather than evidence-complete against its original targets.
PERF-03/04/05/06/07/08/11/13 remain open. No other gate is waived by this decision.

Recommended next work is **PERF-11, connection-budget verification first**: inventory
the actual owner/readiness pools, workers, deployment overlap and provider reserve;
check the declared budget against the serving topology; reuse existing native
contention/cancellation evidence and identify the remaining live gaps. Keep the
safe-read deadline flag off, preserve payment/provider UNKNOWN and idempotency,
and do not change pool sizes, region or runtime configuration as part of this report.
PERF-03 attribution gaps stay explicit; APAC and endpoint deadline rollout remain
separate deferred work. This is a recommendation, not authorization to deploy it.
