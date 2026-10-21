# Intermittent Couple profile 500: follow-up, 2026-10-18

The deployed error persists after the owner-approved acquisition-timeout rollout.
This follow-up preserves the earlier [bounded successful rollout samples](web-api500-rollout-latency-2026-10-18.md);
those samples did not establish that intermittent failures were eliminated.

## Live reproduction

Target: the existing synthetic booking, through `wedding-web-silk.vercel.app` and
direct Railway. Deployment `df563b30-08b6-41bc-949d-cb908f2650b9`, source
`cc2999acdd24dc87e713806328022b160585c599`, image
`sha256:d201a414b903413b28724591c52f2ab3a3cc0492818dd42d58ed2af370d55892`.
The common pool remains one connection; acquisition wait remains 10000 ms.

- The screenshot request `1f8aac3e-22d7-41f5-adc5-95b94a53a8ac` matches
  `PrismaClientKnownRequestError` and a completed 5xx on
  `/consultations/:consultationId/couple-profile`, 2282.356 ms backend time,
  at `2026-10-18T00:25:39.908Z` (07:25:39 Asia/Saigon).
- Ten serial profile reads (five through each origin) returned 200.
- Three four-reader cohorts mixed two profile reads, one proposal and one contract
  read. One of twelve requests failed: Vercel profile request
  `21b94023-bd11-4fbd-92ac-225a28b00eeb`, HTTP 500 / `INTERNAL_ERROR`,
  3841.959 ms client / 2754.809 ms backend. Another profile request in the same
  cohort returned 200. The direct cohort returned four 200s.
- All 28 HTTP operations, including two normal session lifecycles, correlate to
  this deployment's logs. Both sessions were revoked; reuse returned 401.
- Mixed-cohort proposal responses took 5.963–7.484 s through Vercel; contracts
  took 5.194–6.103 s. These remain performance work, independently of the profile fix.

This confirms the owner's intermittent-failure report. Serial success alone is
insufficient acceptance evidence. Live logging records the Prisma error name but
does not record its code/message, transaction holder or SQL; the exact code of
each live failure remains unobserved.

## Reproduced mechanism and source fix

The profile GET previously used an interactive Prisma transaction for the profile
and access-grant reads. Installed Prisma 7.10.1 defaults transaction admission
`maxWait` to 2000 ms and transaction execution `timeout` to 5000 ms. This admission
limit is separate from the pg pool's configured 10000 ms acquisition wait.
See the [versioned upstream implementation](https://github.com/prisma/prisma/blob/7.10.1/packages/client/src/runtime/getPrismaClient.ts).

A native PostgreSQL regression test holds the only pool connection in a read-only
transaction for 2500 ms, then releases it. With the original service, it fails with
`P2028`, "Unable to start a transaction in the given time." With the candidate
service, it returns the authorized profile and the same connection remains usable.
This proves a concrete source defect consistent with the live timing and error
class; it does not retroactively establish unlogged live error codes.

`couple-profile.service.ts` now reads the five response fields and authorizes access
in one parameterized SQL statement. It avoids interactive-transaction admission and
keeps profile/grant visibility within one statement snapshot. Schema qualification
uses the existing configured-schema helper with quoted identifiers.

The write transaction, revision conflict, audit history, response schema and
concealed 404 behavior are preserved. Tests cover the owning Manager, restricted
prospect, Couple, Manager+Staff, Staff+Couple, rejected Staff-only reads, foreign
actors, revoked/missing grants and a configured schema containing a quote. Legacy
null names remain null. No migration, dependency, frontend or OpenAPI change.

## Verification and release status

- Candidate commit `32a25a8bf0eed993b3de2fe73e116e38698cdb65`,
  [draft PR #64](https://github.com/WDP301-wedding/wedding-be/pull/64).
  Only the service and regression test are committed; operator evidence stays local.
- Regression RED: the original read fails with P2028 under occupied-pool admission.
- Regression GREEN: all three native PostgreSQL tests pass, including authorization
  and cross-schema isolation. The earlier two-test version plus commercial
  foundations and booking-lifecycle runtime tests passed 18 tests in three files.
- Typecheck, lint, production build, OpenAPI generation and OpenAPI check pass.
  Lint excludes untracked operator `output/**` for this local invocation only;
  tracked lint configuration and CI gates are unchanged.
- Review mutation: dropping the Staff negation makes an existing granted Staff-only
  actor able to read. The same authorization assertion rejects that mutant while
  the original candidate conceals the profile with 404. The mutation used an
  operator-only module copy; the candidate source was never modified.
- Updated source served from operator localhost against the existing synthetic
  database: three four-reader mixed cohorts, 12/12 GET 200, including six profile
  reads. Login/logout/revocation checks also pass. This is source-candidate
  evidence, not Railway-container acceptance or a matched latency comparison.
- Full Windows coverage: 283/287 files and 2043/2047 tests pass. Four failures
  concern connection timeout, fixture teardown hooks and the runtime CLI timeout;
  `runtime-foundation` also has an afterAll hook timeout. All new profile tests pass.
  A separate fresh-DB, one-worker rerun of the four modules returns 19/20 tests
  passed; FCM still exceeds its unchanged 10000 ms fixture-disconnect hook.
  The initial full run and selected rerun remain failed evidence, not a coverage pass.
- Exact-head Linux CI attempt 1: static/unit/contract/build/audit gates pass;
  549/549 native integration tests pass. Full coverage has 2046/2047 tests passing,
  with one failure in the unchanged `pool-deadline.test.ts`: the 100 ms occupied-pool
  test receives P2028 rather than REQUEST_TIMEOUT. The helper and test have identical
  Git blobs to the base commit. This does not establish the exact cause of its
  timing-dependent mismatch; it is not a profile regression failure.
- One controlled rerun of the failed PostgreSQL CI job on the same source passes:
  105/105 integration files, 549/549 integration tests, then 287/287 files and
  2047/2047 full-suite tests. Overall line coverage is 97.56%, branch coverage
  93.48%; the unchanged per-file 80% gates also pass. The quality job passes
  formatting, lint, typecheck, 1440 unit tests, 58 contract tests, OpenAPI check,
  production build and dependency audit.
  [Exact-head CI, attempt 2](https://github.com/WDP301-wedding/wedding-be/actions/runs/39084286438/attempts/2).
  The original logs and failed result are retained separately in
  `ci-first-attempt.json`, `ci-first-counts.json` and the original job log. No test
  timeout, assertion, skip, source or coverage threshold was changed for this rerun.
  A successful rerun does not resolve the original deadline-classification mismatch.
  That concern remains recorded separately from the profile regression fix.

The candidate is ready for owner review. Merge/deployment approval and concurrent
live verification of the new Railway source remain outstanding; exact-head CI is
not deployment acceptance.

Railway still runs the original source and image. No new configuration, region,
pool cap, provider or deployed source change was made in this follow-up. Shared
API calls were GETs apart from normal login/logout/revocation checks; local tests
use disposable native PostgreSQL databases. No payment, generation, retention or
cleanup operation was invoked on the shared fixture. No new shared-business
before/after digests were collected in this follow-up; the preceding rollout's
digest evidence remains limited to that earlier run. Both local clusters started
for this investigation have been stopped, with data retained.
PERF-13 and the existing production NO_GO remain open.
The source candidate addresses this profile read only; it does not establish
capacity or remove transaction-admission limits from other routes.

[Sanitized receipt](web-api500-profile-contention-2026-10-18.json) records the
request correlations, original failure, candidate verification, both CI attempts
and final serving-state check.

Operator artifacts: `output/api500-profile-20261018/`, including
`live-correlation.json`, `red-reproduction.log`, `green-schema-native.log`,
`candidate-source.json`, static-check logs and the full-suite log. Earlier failed
local database startup and schema-fixture attempts are retained separately and
are not counted as application regression results.
