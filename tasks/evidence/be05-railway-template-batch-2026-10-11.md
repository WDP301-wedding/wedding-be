# BE-05 print catalog timeout: Railway confirmation and correction

Operator: Codex, 2026-10-11 (Asia/Saigon). The owner explicitly requested checking
the reported issue on Railway and fixing it if real. The existing developer-only
test authorization permits synthetic catalog mutations; no real-money payment,
generation, guest data or provider delivery is involved.

## Confirmed deployed failure

Target: Railway `wedding-be`, environment `production` (developer test), API
`https://wedding-be-production-e1dc.up.railway.app/api/v1`.
Source before correction: `3f7842097977e8c931edfe1cfdd176c2d2006a58`;
successful deployment `4c50c25f-c83c-4a75-bcc8-349d6b4949bc`.

There were no active print offerings or templates before this rehearsal. The owned
test Manager created one synthetic template and 50 synthetic offerings through
their actual mounted HTTP commands. No existing catalog history was changed.

| Request | Result before correction | Client elapsed | Request ID |
| --- | --- | --- | --- |
| GET /catalog/print-offerings?limit=1 | 200, one item | 3,142 ms | 3da641e3-17b3-437e-91e3-8fe987958199 |
| GET /catalog/print-offerings?limit=20 | 500 INTERNAL_ERROR | 6,221 ms | 02aae9d9-03cb-4f31-819f-f7430fa13e50 |
| GET /catalog/print-offerings?limit=50 | 500 INTERNAL_ERROR | 6,431 ms | 69d9d756-f8a9-4467-acb5-ed59d2ff9393 |
| GET /catalog/print-offerings?limit=50, repeat | 500 INTERNAL_ERROR | 6,408 ms | 67dfcc3e-99f5-43a2-bbc9-3ac872c2907c |

Railway logs correlate all three failing request IDs with
`PrismaClientKnownRequestError`. Those deliberately redacted logs do not expose
Prisma's error code/message. The prior direct disposable probe captured P2028 and
the five-second transaction deadline. The current source performs three sequential
template queries per candidate in that same default-deadline transaction. No
latency injection was used for the Railway HTTP requests above.

## Correction and regression proof

Invitation's owner port now supplies a bounded `findSelectableSelections` batch.
It validates at most 50 references, locks each distinct template head in stable UUID
order, then reads active/current exact-version scalar facts with one joined query.
Both locks and facts remain inside Venue's enlisted transaction; standalone callers
receive their own transaction wrapper. Only IDs, revision and validated title leave
Invitation. Missing/inactive/superseded sources are filtered, and unexpected failures
propagate. Historical readers and single-selection conflict codes are unchanged.

Venue calls the batch once per candidate page, retaining order, page cursor rules,
active offering checks and frozen historical prices. No transaction deadline was
increased and no migration or HTTP schema change is needed.

Two new real PostgreSQL/HTTP regressions use 50 offerings with either one shared
template or 50 distinct templates and 40 ms of controlled delay per database
operation. Both returned 500 before the fix and 200 with all 50 expected IDs after
the fix. Additional persistence tests cover duplicate/empty/oversized/invalid
batches, inactive/missing/superseded sources, safe frozen metadata, and blocking a
template archive while the caller's batch transaction retains its locks. The
mounted owner test also exercises the standalone batch provider.

Private raw HTTP fixture/session state and Railway logs remain in gitignored
`.local-demo/`; committed evidence contains no credentials or private template
content. The deployed correction and cleanup evidence follow below.

## Local verification checkpoint

- Local unit and contract selection passes: **126 files / 1,177 tests**.
- `format:check`, `lint`, `typecheck`, `build`, `api:generate`, `api:check` and
  `git diff --check` pass. OpenAPI remains unchanged at
  `fcc54f3a842836e17ca056ca2ec81cec6172c28f79c3831477418c721e273184`.
- The final focused commercial/latency suites pass: **2 files / 14 tests**.
- The mounted Booking runtime file also passes all four tests with the batch owner
  provider during the broader run.
- The attempted full Windows threads/coverage run terminated natively with code
  `3221226505` while starting the commercial suite, without a failing assertion.
  It is not counted as a full-suite or coverage pass. This failure class was already
  recorded in the original BE-01–05 evidence. The full Linux CI run below provides
  the required integration and coverage gate; thresholds and test inventory were
  not relaxed.

## Full Linux CI and developer deployment

[GitHub Actions run 38098194493](https://github.com/WDP301-wedding/wedding-be/actions/runs/38098194493)
passes both required jobs at source commit
`8f65affed4abcc2b19ccdee2c0b8b6d0265840c5`: formatting, lint, typecheck,
unit/contract tests, OpenAPI generation consistency, build, dependency audit,
migrations against empty PostgreSQL, integration and full-suite coverage.
Integration: **65 files / 348 tests**; full suite: **191 files / 1,525 tests**.
Full-suite coverage is **96.55% statements, 93.45% branches, 98.29% functions,
97.31% lines**, with the existing per-file thresholds enforced. Supplemental
local coverage on the two changed implementations passed 18 tests across three
files, with 98.91% combined lines and 97.67% branches; it was not substituted for
the full CI gate.

After both CI jobs passed, the clean feature-branch checkout at that source commit
was uploaded through the native Railway CLI under the existing developer rehearsal
authorization in `docs/railway-deployment.md`. Deployment
`d6e8690f-fb48-4439-8d60-3d88e012f6a4` reached **SUCCESS**. CLI-uploaded deployment
metadata does not include GitHub commit/branch fields; the source above is the
verified clean checkout uploaded, not an inferred metadata value.

Read-only inspection after upload confirms automatic deployments remain enabled
from `WDP301-wedding/wedding-be`, branch `main`, with `checkSuites: true` (Wait for
CI). [PR #26](https://github.com/WDP301-wedding/wedding-be/pull/26) remains open for
the required team review. This developer deployment does not merge or waive review
on `main`, and is not production readiness evidence.

## Same-fixture deployed verification

These requests used the same 50 active synthetic offerings and template as the
failing requests, without latency injection:

| Request | Result after correction | Client elapsed | Request ID |
| --- | --- | --- | --- |
| GET /catalog/print-offerings?limit=1 | 200, one item | 1,908 ms | 33fd15db-dd6f-4ba8-be21-4afc9039561b |
| GET /catalog/print-offerings?limit=20 | 200, 20 items | 1,749 ms | 8aeed53a-0ad0-4dfd-99a8-ad4ea9cb6180 |
| GET /catalog/print-offerings?limit=50 | 200, 50 exact fixture IDs | 1,927 ms | cd88fb57-2df0-468b-91be-1e9cff96ff19 |
| GET /catalog/print-offerings?limit=50, repeat | 200, 50 exact fixture IDs | 1,948 ms | a9a90e6f-b7d5-45e5-935e-0c2df72ac496 |

Railway application logs correlate all four request IDs with `2xx` completion and
server durations of 1,494–1,641 ms, without an application error event. The live
canonical OpenAPI matches local bytes and the unchanged digest above; all seven
BE-01–05 path groups remain present, browser OpenAPI and Swagger load successfully,
and liveness/readiness and the public hall catalog return 200. The positive
catalog result above, rather than health alone, is the behavior acceptance proof.

## Cleanup and outcome

The owned test Manager successfully archived all **50 offerings and the one
template** through their owner HTTP commands, retaining immutable revisions. A
subsequent authenticated `limit=50` request returned **200 with zero items**
(request `5277b6d7-4477-4b55-8666-898cb603b8c5`, at 00:39:13 UTC). The account's
session inventory identified four active rehearsal sessions; all four were revoked
through the owner session APIs, including the current session, by 00:39:24 UTC.
No other account or existing catalog record was modified.

An optional direct SQL cleanup cross-check could not connect from this Windows
host: Node DNS returned ENOENT and verified Windows AAAA resolution then reached
ENETUNREACH. TLS verification was retained. No SQL cleanup success is claimed;
the successful archive commands and empty HTTP catalog above are the cleanup
evidence.

The original BE-05 P2 finding is resolved on the developer Railway deployment,
with regression tests and full CI passed for its source commit. The reviewed
feature branch remains pending team approval before merge into `main`.
