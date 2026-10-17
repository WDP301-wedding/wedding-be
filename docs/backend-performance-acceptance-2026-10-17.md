# PERF acceptance follow-up — 2026-10-17

Scope: complete the remaining evidence requested by the owner after the
[connection-lifecycle report](backend-performance-followup-2026-10-17.md).
Application optimizations, APAC placement and deadline rollout are outside this
follow-up. The deadline, diagnostics and optional DB probe remain disabled.

## Report closure and next step

This checkpoint closes the report and its measured evidence, not all PERF
acceptance. The canonical checklist has **3/13 complete: PERF-01, PERF-02 and
PERF-12**. PERF-03 through PERF-11 and PERF-13 remain open; delivered code,
successful cohorts and runtime cancellation proof do not by themselves close
their full acceptance criteria. PERF-12 completes retention review, not deletion.

The next work item is a measurement-only PERF-10 verification slice: establish
secret-safe refresh-invocation counts that distinguish scheduler work from HTTP,
then compare matched baseline/candidate TTL-refresh cohorts and separately repeat
warm reads with a pinned generation and stated background workload. Require
twenty samples per comparable single-reader variant and three four-reader expiry
waves, retaining all conflicts, failed attempts and generation transitions. Do not
infer invocation counts from identical returned generations or silently discard
slow warm trials. Refresh improvement must demonstrate the planned thirty-percent
target; warm p95 must meet the two-second experiment target. Any required
instrumentation/deployment is a separately reviewed change, not part of this report.

Do not start another optimization, move APAC placement or enable endpoint deadlines
as part of report publication. Production readiness remains `NO_GO`.

## PR #53

[PR #53](https://github.com/WDP301-wedding/wedding-be/pull/53) merged as
`9ae3f24100b0bbd0ac34f739d7e35bc111a20b58`. Its exact head
`70d398ab996dad6832fe7024bb61a56b68e7f2ce` passed
[Backend CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38950384458):
1,981 tests and unchanged coverage gates. All four changed files are documentation
or evidence; review had no Required finding or unresolved conversation.

The first [merge-commit CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38983491799)
failed the existing request-logging test. Its raw log shows `123` inside timestamp
`2026-10-16T23:52:27.123Z`; the test searches the entire serialized log for the
three-digit synthetic CVV. This is a false-positive substring match, not evidence
that a request body was logged. The first rerun failed before tests because the
public ECR PostgreSQL image returned `toomanyrequests: Data limit exceeded`.
Both failures are retained. A further exact-head infrastructure rerun is recorded
separately; no test, assertion, coverage gate or workflow was weakened.
That rerun passed 1,981 tests, with 97.55% lines and 93.49% branches and the same
per-file gates. The merged change affects documentation/evidence only; deployed
application source remains equivalent to the merge for runtime files.

## Catalog with real Storage media

A new, retained synthetic hall `be5d4496-de6a-4666-8d17-3202b1f873ed` has one
backend-uploaded PNG in the configured private Supabase Storage bucket. It is
separate from existing published catalog records and the original booking fixture.
The image is 64 × 64 pixels, 237 bytes, with SHA-256
`7dfc8d5e2dcb1acb6556bf9e4e237d19385f7d3bf744ccbc6488be9406bc575d`.

Public hall listing and detail each completed one initial read plus twenty steady
reads: **42/42 HTTP 200**, with the actual asset present in every response.
**21/21 signed provider reads** returned 200 and matched byte count, checksum and
decoded image dimensions. Provider metadata independently matched the content.
The normal signed-URL lifetime is 900 seconds and later requests produced fresh
signed URLs. Signed URLs and provider credentials are excluded from the evidence.

Unsigned private-bucket reads and an expired one-second signed URL both returned 400. The management media API denied anonymous access with 401 and Couple access
with 403, and allowed Manager access with 200. Both measurement sessions were
revoked with 204, followed by 401 reuse checks.

This closes the missing real-Storage path for this one-asset hall cohort. It does
not establish a thirty-percent live improvement against a matched media-bearing
baseline or real-provider results for twenty assets per page. Existing native
cardinality regressions remain separate evidence.

| Catalog case, 20 steady reads              | Client p50 / p95 | Backend p50 / p95 |
| ------------------------------------------ | ---------------: | ----------------: |
| Public halls, three halls / one real asset |    958 / 1226 ms |      707 / 999 ms |
| Public hall detail, one real asset         |    915 / 1237 ms |     679 / 1002 ms |

The initial list read was 3790 ms client / 3264 ms backend and remains separate
from steady samples. The initial detail read was 1204 / 978 ms. Provider SDK was
`@supabase/storage-js@2.116.0`; this is the client version, not a claim about the
provider's server release.

## Analytics

The previous five successful full rebuilds followed by 409
`ANALYTICS_REFRESH_CONFLICT` remain an incomplete protocol in the original receipt.
No rebuild POST retry is part of this follow-up.

The new GET-only protocol observes `AnalyticsHead` and all six source checkpoints
inside read-only SQL statements, using `clock_timestamp()` from the selected DB.
It waits for natural TTL expiry; it does not edit checkpoints, stop the scheduler,
change the clock or reset business data. Before each wave, at least one checkpoint
must already be sixty seconds old on the DB clock. Client request timestamps and
generation ages are retained independently.

Five read-only clock probes bound the DB clock approximately 6.31–6.57 seconds
ahead of the operator clock. Client wall-clock age alone would therefore classify
some stale starts incorrectly. TTL classification uses the DB observation and is
cross-checked against request start times inferred from the exact deployment's
server completion timestamps and backend durations. Neither client timing nor DB
clock skew is silently treated as application execution time.

The planned cohort is twenty single-reader stale starts followed by three waves
of four readers. The scheduler remains enabled. A pre-dispatch stale snapshot and
a changed response generation demonstrate the observed transition, but do not
identify the winning publisher or count HTTP-triggered refresh executions. These
limitations must remain explicit when assessing the no-herd and refresh-improvement
targets. The original successful twenty-read same-generation warm cohort remains
preserved; additional warm trials are reported separately with their traffic and
generation cohorts.

The initial observer was stopped after ten completed single-reader waves because
`Date.parse(Date)` discarded fractional seconds. Recorded ages were conservative,
so the retained stale samples remain valid, but the wait could overshoot a short
natural-expiry window. The correction uses `Date.getTime()` and affects only the
operator runner. A continuation prioritizes the three four-reader waves, then
collects the remaining ten single-reader samples. Both receipts and the operator
stop remain visible rather than presenting the first protocol as uninterrupted.

The four-reader waves deliberately dispatch simultaneous starts after one DB
snapshot to test the same expiry boundary. They are a distinct protocol from the
earlier 750-ms-staggered bounded-reader comparison. Observed API starts per rolling
minute and maximum in-flight measured requests are retained in the final receipt.

The stopped runner's exact session was identified through its login request ID,
revoked through the owned-session API with 204, and independently confirmed
`REVOKED` with zero active access credentials. Its old token was not retained, so
this manual cleanup has persisted revocation proof rather than a token-reuse
request. The cleanup operator's separate session has its usual 204/401 checks.

The completed cohort contains **20/20 successful single-reader stale starts** and
**12/12 successful concurrent reads** in three four-reader waves. Every wave
returned a new `READY` generation. Server logs confirm four overlapping requests,
one returned generation and identical report facts within each concurrent wave.

| Current natural-stale cohort |   n | Client p50 / p95 | Backend p50 / p95 |
| ---------------------------- | --: | ---------------: | ----------------: |
| Single reader                |  20 |   6643 / 8312 ms |    6160 / 7300 ms |
| Four readers                 |  12 |   8445 / 9319 ms |    8073 / 8922 ms |

These are stale-start transition timings with the scheduler enabled. Seven of the
twenty single-reader responses have all returned source checkpoints refreshed
during that request; six have all returned checkpoints refreshed before the
request started; seven straddle request start. All subgroup timings and raw
timestamps are retained. A generation transition cannot be reported as an isolated
GET-triggered refresh or as a counted single source execution. There is still no
matched live TTL-refresh baseline establishing a thirty-percent improvement.

The supplementary warm-labelled trial had nineteen same-prior-generation reads
and one generation transition while catalog measurement also ran. Its client /
backend p95 was 2575 / 2197 ms, exceeding the 2-second client target; its maximum
was 8319 / 7826 ms on the transition. The nineteen same-generation reads also have
client p95 2575 ms. These results do not replace the earlier independent twenty-read
same-generation cohort at 1639 / 1411 ms, and prevent an unconditional warm-speed
claim across workloads.

## Staff event window

The only existing active Staff assignment belongs to the original event dated
2026-11-19. The real event window is closed today. No approved event date, contract,
assignment or check-in ledger on that booking is changed for measurement.

An attempt to create a separate historical booking through the public API returned
422 `VALIDATION_ERROR`. The API requires an event date from the day after tomorrow
in Vietnam time (`event-date.ts`), so even a new same-day API booking cannot supply
today's Staff-window cohort. The newly created synthetic hall, media and intake
remain retained; no historical booking, synthetic accounting receipt or actual
check-in was created by that rejected request.

The owner subsequently explicitly chose a separate historical synthetic fixture.
Booking `984bd852-462f-4ede-854a-436b108a1851` was first created legally for
2026-11-19 in the new hall. An audited native seed then changed only that new
draft's date and active hold to 2026-10-16, before creating its first commercial
revision or payment attempt. The transaction checked fixture ownership, draft
revision, absence of commercial/payment facts and the real DB event window.
Audit action `performance.synthetic-historical-fixture` records the authorization
and both dates. This exceptional fixture seed is not historical-date acceptance
through the public booking API and does not change its validation rule.

All subsequent timeline/contract approvals, labeled synthetic manual accounting,
explicit named-Guest check-in configuration, active Staff assignment and confirmed
seating used the existing owner APIs. Normal deposit application established FULL
access; no FULL grant or provider settlement was inserted directly. The new
immutable contract already contains 2026-10-16. Its one MANUAL/SUCCEEDED accounting
attempt is not a real transfer or external provider proof. Eight named synthetic
Guests, explicit planning headcount 50 and five tables remain separate facts.
No invitation generation, external email, actual check-in or undo was invoked.

The dinner shift is 17:00–22:00 on October 16. Its actual Staff window is
October 16 15:00 through October 17 10:00 in Vietnam time. Both measurement-boundary
snapshots use `clock_timestamp()` and confirm the window is open, with active
assignment and `BY_GUEST_NAME`; no clock override or authorization bypass is used
for the Staff GETs. The original November booking and its immutable history remain
unchanged.

The first setup attempt stopped on the operator's native DB connection timeout;
all three API sessions were revoked with 204/401. A continuation reused the same
new draft and increased only the local seed runner's connection/transaction budget,
not deployed pool settings. A read-only proof assertion initially mislabeled the
MANUAL attempt as an external-provider attempt; the original observation and
query correction are retained. Neither failure is hidden as a passing run.

Assigned Staff guest search completed **21/21 HTTP 200 reads**, each returning
the same eight Guests, confirmed seating guidance and no checked-in entries. The
initial read was 8690 ms client / 8465 ms backend. The twenty sequential steady
reads had client p50 / p95 **8628 / 9026 ms** and backend **8400 / 8417 ms**;
maxima were 10655 / 10432 ms. The twenty steady samples are separate from setup
and the initial read. Read-only seed-proof queries overlapped early samples, so
this is not an isolated or matched before/after speed comparison. In particular,
the earlier Manager-role search is not a Staff baseline. No check-in ledger row
was added; that is a read-only invariant, not whole-event attendance evidence.

The measurement session has 204/401 cleanup checks. The temporary invitation-
acceptance session has an exact logout audit/request ID, a 204 completion log,
persisted `REVOKED` state and zero active access/refresh credentials; its old token
was not retained for a reuse probe. Combined with the previously measured seven
Couple families, this closes the missing role/window coverage for PERF-02 only.

## Evidence and acceptance

The preserved [pre-Staff machine-readable receipt](../tasks/evidence/perf-acceptance-followup-2026-10-17.json)
includes all 158 measurement/session/setup/cleanup operations and four postflight
requests, each uniquely correlated to the same exact deployment's completion log.
It retains raw timings, generation metadata, subgroup summaries and artifact hashes.
All 111 polling observations and complete before/after checkpoint snapshots remain
in the hashed raw operator receipts under `output/perf-acceptance-20261017/`.

The subsequent [Staff-window appendix](../tasks/evidence/perf-staff-window-2026-10-17.json)
supersedes that receipt's pending Staff choice and pre-Staff retention checkpoint,
without replacing its measurements. It adds **83 uniquely correlated requests**,
including both setup attempts, the temporary acceptance-session logout, 21 Staff
reads, measurement-session cleanup and four fresh postflight probes. The combined
total is **245 unique request IDs** with exact deployment completion matches. All
38 original raw checkpoint artifacts still match their recorded hashes.

Combined observed operator traffic reached at most 30 API starts per rolling minute and
four concurrent measured API requests. All selected fifteen original business-table
count/digests and all sixty migration checksums still match after Staff measurement.
Public table count remains 145. The new hall, Storage object, intake, confirmed
historical synthetic booking, approved contract, manual test accounting and layout
are retained; do not erase or rewrite their history. The rejected historical API
request itself created none of those booking/financial facts. The new booking is
outside the unchanged notification booking allowlist.

Final postflight confirms deployment `dd402ca3-7474-47e9-945f-5bf0698f5cfb`,
source `df70188f80738c0744c7411adf9e922463f2193c`, one running SFO replica, pool
max 3, acquire timeout 2000 ms and idle timeout 60000 ms. Deadline, diagnostics and
the one-off DB probe remain false. Provider configuration hash and original service
commands/CI-gated trigger are unchanged. This documentation-only merge required no
new application rollout. Health/live and readiness returned 200, anonymous Identity
returned 401, and OpenAPI SHA-256 remains
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.

The real-media hall path, current natural-stale read cohort and assigned Staff
in-window reads now have live evidence. PERF-02 fixture/read coverage is complete.
PERF-10 still needs a matched refresh-improvement baseline and direct refresh-
invocation attribution to close its full target; the observed warm workload limit
also remains visible. APAC and endpoint deadline rollout remain deferred. Missing
comparative or broader live-scope evidence leaves PERF-09/10/13 open. Product
production readiness remains `NO_GO`; these tests do not replace separate provider
and release gates.

Receipt consistency, unique request/deployment correlation, supplied-credential
scan and relative report links passed. Changed-document Prettier and
`git diff --check` passed. Application source, migrations, OpenAPI and provider
configuration were not edited in this follow-up.

Execution record for the owner-authorized fixture: the initial and continuation
commands used `node --import tsx output/perf-acceptance-20261017/setup.mjs --authorized-historical-seed`;
the continuation set `PERF_OPERATIONS_FILE=setup-historical-continuation-operations.json`.
The exact continuation source is archived as `staff-setup-authorized.mjs`, while
the original prepared runner and all 38 pre-Staff artifact hashes are preserved.
This is an execution record, not authorization to create another accounting fixture.

`node output/perf-acceptance-20261017/staff-window-measure.mjs --measure-new`
passed 21 reads and cleanup in the real Railway/demo environment.
`node output/perf-acceptance-20261017/staff-verify.mjs` passed 245 unique request
IDs, 59 artifact hashes, all receipt invariants, credential/signed-URL scans and
80 relative document/evidence links. The exact deployed image remains
`sha256:cbe33b01f4d964c1eb26f0a2fc94f63fc0f7dd2dee4b63b63442d5bf91a9dd0d`.
