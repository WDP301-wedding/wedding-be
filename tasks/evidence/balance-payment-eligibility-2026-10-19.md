# Balance checkout eligibility verification — 2026-10-19

Scope: owner-approved backend extension for the missing-final-invoice checkout
conflict. Base `origin/main`: `6626a3a44b306300fee78a6509e8fb4cfb2099e0`.
Implementation branch: `codex/balance-payment-eligibility`. The original checkout's
uncommitted work is not included. See the [API hand-off](../../docs/balance-payment-eligibility.md).

This local verification snapshot is preserved separately from the final review
result. [PR #76](https://github.com/WDP301-wedding/wedding-be/pull/76) records the
latest validation summary and exact-head [CI checks](https://github.com/WDP301-wedding/wedding-be/pull/76/checks).
Use those checks for the candidate currently under review; a local partial pass
does not substitute for the whole-repository gate.

## Result and boundaries

The authorized billing GET adds `data.balancePaymentEligibility`. A missing final
invoice returns a business-block reason with `WAIT_FOR_FINAL_INVOICE`, while balance
POST still rejects `INVOICE_FINALIZATION_REQUIRED`. No automatic invoice finalization,
gateway call or payment write occurs on GET. Full-contract invoice pins, integer VND,
immutable history, authorization, booking boundaries and payment idempotency remain.

This record covers local verification only. It is not deployment, browser E2E,
live VNPay or settlement evidence. No shared booking was finalized or changed.
Frontend integration and exact-target verification remain `BILL-ELIG-02`.

## Isolated environment

- Node.js `24.15.0`, existing locked dependencies and generated Prisma client.
- Native PostgreSQL 18 in a new disposable cluster, listening only on loopback
  port 55446; Docker was unavailable. This differs from CI's PostgreSQL version.
- All existing immutable migrations applied successfully to a new local database.
  No migration, dependency or frontend source changed.
- Integration helpers created/dropped their own disposable databases. External
  providers in tests were controlled fixtures; no live credentials were loaded.

The first native integration attempt failed with `ECONNREFUSED` on the unavailable
default local test port. That failure was not treated as a pass; native checks were
rerun against the isolated PostgreSQL instance. A concurrent static-check chain was
interrupted during build to reduce resource contention, and is not build evidence.

## Verification

Commands below are package-script equivalents, invoked through the installed Node
binary. Database URLs for integration/coverage selected only the disposable local
instance via `TEST_MIGRATION_DATABASE_URL`, `MIGRATION_DATABASE_URL` and `DATABASE_URL`.

| Check | Result |
| --- | --- |
| RED: new eligibility unit specification before implementation | Failed because the new helper module did not exist |
| New eligibility unit tests | 10 passed |
| Full-contract focused native API cases | 2 passed; remaining 31 cases excluded by the explicit test-name filter |
| Native billing views | 7 passed |
| `vitest run tests/contract --maxWorkers=2` | 21 files / 68 tests passed |
| Changed source/test/hand-off Prettier check | Passed |
| `tsx scripts/openapi.ts` and `tsx scripts/openapi.ts --check` | Passed |
| First whole-repository coverage attempt, two fork workers | Failed: 281 files passed, 8 failed, 3 worker exits; 2,104 tests passed and 14 failed, as reported by Vitest |
| Final typecheck, build and full lint | Passed |
| Sequential whole-repository coverage retry, one thread worker | Process exited with `-1073740791` / `0xC0000409` before its JSON/coverage summary; not a pass |
| Payment-module tests and changed-runtime-file coverage | 40 files / 253 tests passed; ledger worker exited abnormally before four tests completed. The run failed and is not full module acceptance |
| Reported coverage of all six changed runtime files | 97.66% lines / 94.81% branches overall; each file exceeded 80%. Partial-run metrics, not a passing whole-repository receipt |
| Linux CI on the current candidate | Authoritative current result is on PR #76's checks; exact-head success is required before merge/readiness claims |

Focused API filter:

```text
requires finalization before a full-contract balance payment|pins zero-expense final invoices
```

Initial full-suite command:

```text
vitest run --coverage --maxWorkers=2 --reporter=dot --reporter=json --outputFile=output/eligibility-full-coverage.json
```

Two failed assertions prohibited the substring `reason`, which also matches the new
public `reasonCode`. They now explicitly prohibit the private JSON key `"reason"`,
keep the private-value/evidence assertions, and assert the expected public eligibility
state through the strict response contract. No private financial reason is exposed.

Other first-run failures included connection/teardown/test timeouts, a teardown
deadlock, and three Windows fork exits (`3221226505`) in notification performance,
print order and commercial foundation suites. These are not claimed to be caused
by this change or definitively explained by resource contention. The existing
[baseline record](booking-multi-menu-proposals-2026-10-18.md) also leaves the broad
Media/FCM coverage gate open due to timing variability. Isolated passes do not turn
the failed broad run into a pass. The retry uses a new migrated local database,
one thread worker and no parallel static checks, without increasing timeouts:

```text
vitest run --coverage --maxWorkers=1 --pool=threads --reporter=dot --reporter=json --outputFile=output/eligibility-serial-coverage.json
```

The sequential process also terminated abnormally. No definitive native-crash root
cause is established. There is no completed sequential report or global coverage
receipt. Do not count its dots or started files as passing tests. A bounded payment
module run reports the six changed runtime files with the existing per-file 80%
thresholds, but also failed because the ledger worker exited with `3221226505`.
No failed assertions were reported in that bounded run; its unhandled worker error
still prevents an overall pass. The corrected privacy suites completed: acceptance
1/1, HTTP 11/11, plus eligibility 10/10. A draft PR obtains exact-candidate Linux CI;
no merge or deployment is implied. On the initial source commit `839ecc1`, Linux CI
completed static, unit, contract, build, audit and native integration gates; full
coverage was still running when this local snapshot was captured. Current exact-head
results are retained in the PR rather than inferred from these partial local runs.

Bounded command scope: `src/modules/payments-billing`,
`tests/integration/payments-billing`, the full commercial API suite, and payment /
commercial-step6 contract tests, with one fork worker and six explicit
`--coverage.include` paths. All six files appear in the JSON coverage summary:

| Changed runtime file | Lines | Branches |
| --- | --- | --- |
| `balance-payment-eligibility.ts` | 100% | 100% |
| `billing-operations.service.ts` | 95.48% | 93.02% |
| `billing-views.service.ts` | 100% | 96.66% |
| `payments-billing.openapi.ts` | 100% | 100% |
| `payments-billing.schemas.ts` | 100% | 100% |
| `payments-billing.providers.ts` | 100% | 100% |

Local receipts are under `output/eligibility-*.json` / `output/eligibility-*.log` in
the implementation worktree; database files and generated receipts are not staged.
The full-suite coverage configuration retains the existing 80% line and branch
threshold **per file**. No test, threshold or assertion was disabled to obtain a pass.

## Covered behavior and review

- Owner and Manager can read the new field; anonymous/unrelated/Staff-only actors
  retain their existing authorization/concealment responses.
- Full contract without invoice: GET 200 with blocked eligibility, POST 409, no new
  invoice/payment attempt. Normal invoice finalization enables the advisory read.
- Legacy contract behavior is preserved. Disabled VNPay configuration, unsupported
  amount, mismatched invoice totals and zero/credit balance block checkout.
- CREATED, PENDING, UNKNOWN and unapplied SUCCEEDED balance attempts block another
  checkout. Reads do not reconcile or create ledger entries.
- Historical ledger fences return `STALE_BILLING_REVISION` and the current nested
  revision. Pagination does not reduce the balance used to evaluate eligibility.
- Strict response parsing rejects extra fields and contradictory states, including
  incompatible reason/action pairs. Unexpected operational or authorization errors
  propagate through the existing error boundary.

Review considered correctness, readability, module boundaries, authorization and
bounded query cost. Financial checks are shared with balance command admission;
eligibility reads run under the existing read boundary after authorization. No
provider I/O is added. A positive advisory result does not reserve funds or bypass
POST revalidation, and configuration does not establish provider availability.

Generated OpenAPI SHA-256:
`c0dabf1f60d1edd6570eb7f4967d695358037b64f0cd42ca14512e5323e8faa6`.
The artifact declares the required billing field and named strict
`BalancePaymentEligibility` component. Consumers using strict whole-response
validators must update them alongside their generated API contract.
