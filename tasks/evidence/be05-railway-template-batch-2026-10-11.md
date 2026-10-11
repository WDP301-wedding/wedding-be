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

Full quality gates and post-deployment verification are recorded below after they
complete. Private raw HTTP fixture/session state and Railway logs remain in
gitignored `.local-demo/`; committed evidence contains no credentials or private
template content. The synthetic records will be archived through owner commands,
retaining immutable history.

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
  recorded in the original BE-01–05 evidence. Full Linux CI integration and coverage
  remain required before the feature-branch developer deployment; thresholds and
  test inventory are not relaxed.
