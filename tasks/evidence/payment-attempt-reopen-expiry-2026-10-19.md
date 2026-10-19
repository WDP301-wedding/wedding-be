# Payment attempt reopen/expiry implementation evidence

Owner explicitly requested implementation of the frontend document after review of
the expiry/late-money tradeoff on 2026-10-19. Implementation branch:
`codex/payment-reopen-expiry`, based on `origin/main@1443f1fa5858ff32ed119ed35df523692ff42232`.
The original checkout's unrelated changes were preserved in its original directory.

## Scope and contract

- [Hand-off and amended policy](../../docs/payment-attempt-reopen-and-expiry.md).
- Existing attempt GET gains optional URI `data.checkoutUrl` for an unexpired,
  unresolved VNPay checkout. Deposit RESTRICTED/FULL and balance FULL permissions
  remain unchanged. Repeated reads preserve the original transaction reference.
- After strictly more than expiry + 15 minutes, authenticated response 91 or an
  unpaid 00/01 response with no payment date/positive transaction can resolve FAILED.
  Timeout, signature/correlation/amount conflict and processing/reversal statuses
  remain UNKNOWN. A success received before resolution still settles once.
- Evidence, failure transition and deposit release use the existing serialized
  owner transaction. The audit preserves the expiry reason and source payload hash.
  A success after committed expiry failure is retained as CONFLICT for operations.
- No migrations, credentials, live provider calls, shared database mutations,
  frontend edits, automatic refunds, deployment or production-readiness claim.
- VNPay PAY/querydr version 2.1.0; fixed sandbox endpoints. OpenAPI SHA-256:
  `b6e8c71ae108e3206a3ea2d99d393b44f6e39e1a2b1e9ec357c7ef4d695c0061`.

## Offline proof

- RED: new PostgreSQL reproduction suite initially failed four cases: URL recovery,
  unpaid deposit expiry, unpaid balance expiry and sparse missing-order expiry.
- GREEN: six focused files, **97 tests passed**, using controlled VNPay transport
  and fresh local PostgreSQL databases. Includes real HTTP checkout/status/billing
  eligibility/replacement, replay, grace boundaries, original UNKNOWN evidence,
  amount/signature/correlation errors, success after expiry and concurrent IPN.
- Coverage with unchanged per-file 80% line/branch gates: service 96.73% lines /
  89.47% branches; protocol 100% / 98.4%; evidence repository 94.54% / 93.15%.
  Combined **97.41% lines / 94.19% branches**, all functions covered.
- Mutation review: inverting the expiry grace comparison caused six regression
  failures. Source was restored before the passing regression/coverage run.
- Final contract suite: **22 files / 96 tests passed**, including optional URI publication
  and authenticated sparse-query normalization without inferring provider settlement.
- Disposable migrations: all **61 existing migrations** applied successfully.
  No applied migration was edited and no new schema migration is required.
- Initial broad Billing run: 117 passed, seven exact-result expectations needed the
  newly added checkout URL; updated expectations preserve status/amount checks.
- A resource-constrained coverage attempt passed all 47 tests but hit a database
  teardown hook timeout; a subsequent 94-test run completed cleanly without changing
  test timeouts, coverage thresholds or application behavior.
- Additional review found that empty optional bank/date fields were rejected and
  an overlong all-zero transaction number was accepted for missing orders. Two
  new protocol tests failed first; the corrected protocol passes **46 tests**.
  The final 97-test run also covers empty unpaid fields through PostgreSQL expiry.
- Plain `npm run test -- --maxWorkers=2` executed 1,616 passing tests but lacked
  database configuration for three existing suites (missing DATABASE_URL and the
  127.0.0.1:1 fallback). Database-dependent suites are rechecked with the repository's
  disposable-database runner rather than changing their assertions.
- Full disposable-database run: **295 files; 2,190 tests passed**, three test
  failures and three suite-hook failures under resource pressure. Errors were
  fixture creation (HTTP 500), pool connection acquisition, the 60-second migration
  test deadline, and database setup/teardown hooks. No VNPay regression failed.
- Serial rerun of the six affected suites passed **58 tests in five suites**;
  the remaining idempotency suite's Windows fork worker exited with native code
  `3221226505`. Its **two tests passed** when rerun alone with Vitest's threads
  pool (`--maxWorkers=1 --pool=threads`). No test, assertion or timeout was edited
  to obtain these results. This is combined whole-suite/rerun evidence, not a
  claim that the initial full run was green.

- Final post-lint HTTP regression: **12 tests passed**. Two unsafe `.body.data`
  accesses in the new tests were replaced with schema-parsed data; no assertion
  was removed and no lint suppression was introduced.
- Final sequential checks all passed on Node **v24.15.0**: `npm run typecheck`,
  `npm run lint`, `npm run build`, `npm run api:generate`, `npm run api:check`,
  and `npm run test:contract -- --maxWorkers=1`. OpenAPI digest remains as above.
- Changed application/test/new hand-off files pass Prettier; staged diff passes
  `git diff --check`. Manual review covers auth before/after reconciliation,
  immutable evidence replay, provider I/O outside database transactions, failure
  release atomicity and late success quarantine. No new dependency is introduced.

Live sandbox and deployed browser acceptance remain pending separately (PAY-REC-04).
