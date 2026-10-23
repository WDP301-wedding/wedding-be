# Couple pre-deposit Android backend verification — 2026-10-23

Owner authorized backend changes so Couple can use the existing pre-deposit and
deposit workflows from the mobile app. Implementation branch:
`codex/couple-predeposit-app-20261023`. This is local implementation evidence, not
deployment, real VNPay settlement, email delivery or native UI acceptance.

## Implemented behavior

- Invitation acceptance atomically grants `COUPLE`, retaining `RESTRICTED` access.
  Existing roles and existing `FULL` access/evidence are preserved.
- Native invitation acceptance issues an Android session and body refresh token,
  sharing one-time token consumption and throttles with Web acceptance.
- Android and Web list identical owned booking scopes, including pre-deposit and
  terminal phases, with the existing strict response and pagination.
- Forward migration adds the role to existing grant owners once, preserving grant
  rows, payment evidence, existing role IDs/timestamps and suspended account state.
- Existing profile/timeline/commercial/deposit APIs work with native bearer sessions;
  post-deposit features continue to require an owned `FULL` grant and their existing
  phase checks. Checkout alone cannot promote access.

## Tests and environment

Native verification uses only isolated schemas/databases under the loopback demo
PostgreSQL at `127.0.0.1:55435`. The repository's
`scripts/staff-operations.verify.mjs` rejects non-demo targets, deploys migrations
into a fresh temporary database, sets all runtime/migration/test URLs explicitly
and removes its own database afterwards. It never uses the application's hosted
database URL as the mutation target. Provider fixtures are controlled/offline.
The local engine is PostgreSQL 18.6, with Node 24.15.0 and Vitest 5.0.1.

Regression tests were written first. The original implementation failed the native
acceptance HTTP test (404), native session-kind test (WEB instead of ANDROID), and
Android booking-scope test (FULL-only filter). Those tests passed after the change.

Selected real PostgreSQL verification:

```powershell
node scripts/staff-operations.verify.mjs tests/integration/identity-access-invitation-acceptance-promotion.test.ts tests/integration/identity-access-runtime.test.ts tests/integration/booking-lifecycle/experience.test.ts tests/integration/couple-predeposit-role-upgrade.test.ts tests/integration/migration-policy.test.ts --maxWorkers=1 --pool=threads
```

Passed: 5 files / 17 tests, with default test/hook timeouts. Includes native
acceptance/login/me/refresh, cross-client invitation replay denial, concurrent
acceptance/promotion, preservation of FULL access on another acceptance, pre-deposit
and terminal overview pagination/ownership, and fresh/forward/reapplied migration.

The commercial API matrix adds a real Android session: timeline create/approval,
commercial draft/submit/dual approval, profile/proposal/PDF reads, server-calculated
deposit checkout and same-key replay/status; it proves no premature FULL promotion,
foreign attempt concealment and denial of the full billing ledger before deposit.

Static/API verification: final typecheck and lint, build, OpenAPI generation/check,
100 contract tests and changed-file Prettier pass. Full regression/coverage results
are recorded below after completion.

Review considered account-role versus per-booking authority, cross-booking/Staff
escalation, client-controlled access/transport fields, credential transport and
single-use/replay behavior, existing FULL/payment evidence, migration duplication
and pagination. No new dependency, PII field or reverse module dependency is added.
Mutation verification forced Android acceptance to return WEB: the native
acceptance regression failed as expected, and the helper restored the original
source byte-for-byte in a finally block.

## Retained unsuccessful local runs

The first focused default-fork run completed 21 assertions, then hit two default
10-second cleanup-hook timeouts and a Windows worker exit (3221226505) before the
commercial matrix ran. A subsequent threads run completed all 34 commercial tests
but timed out during its 10-second cleanup hook under concurrent local checks.
These runs are not labelled passing suites. No production timeout, test assertion,
coverage threshold or repository test/hook budget was weakened to hide them.

A full V8 coverage attempt with a single threads worker exited with status 1 after
starting, without a Vitest completion summary or coverage result. Its local log is
`.local-demo/couple-predeposit-full-tests.log`; no pass count is inferred from this
interrupted attempt. The subsequent single-fork full attempt was interrupted with
the user session before completion; its partial results are not an acceptance run.

## Full regression outcome after resume

The resumed run on 2026-10-23 used the same two-worker forks coverage setting as CI:

```powershell
node scripts/staff-operations.verify.mjs --coverage --maxWorkers=2
```

Result: **311 files / 2,331 tests passed; 3 Windows worker crashes**
(`3221226505`), exit status 1, 1,238.30 seconds. Affected files:

- `tests/integration/payments-billing/http.test.ts`
- `tests/integration/guest-management-http.test.ts`
- `tests/integration/idempotency-repository.test.ts`

This is not a passing full-suite gate. No test assertion failure was reported in
the completed files. Overall reported coverage is 97.02% lines / 92.38% branches,
but per-file gates fail for guest links/router and payments HTTP services/router
with those workers missing. These overall percentages do not override those gates.
The full log is `.local-demo/couple-predeposit-resumed-full-tests.log`; a durable
local status record is `.local-demo/couple-predeposit-verification-status.json`.

Changed implementation coverage from that report:

| File | Lines | Branches |
| --- | --- | --- |
| Booking `experience.router.ts` | 100% | 96% |
| `identity.router.ts` | 100% | 95.91% |
| `workspace-invitation.acceptance.ts` | 97.43% | 93.54% |
| `workspace-invitation.repository.ts` | 93.91% | 86.32% |

All four modified implementation files clear the existing 80% per-file line/branch
bar. This does not close the full-project gate. An isolated threads recovery of the
three missing files also exited without a completion report.

The final single-fork recovery passed **3 files / 22 tests**, with no test/hook
timeout overrides, in 30.67 seconds:

```powershell
node scripts/staff-operations.verify.mjs tests/integration/payments-billing/http.test.ts tests/integration/guest-management-http.test.ts tests/integration/idempotency-repository.test.ts --maxWorkers=1
```

Its log is `.local-demo/couple-predeposit-recovery-forks.log`. Thus all 314 test
files have passing executions across the full run and isolated recovery. Do not
sum the test counts as unique cases: partially executed crash files can overlap.
This recovery was not a coverage rerun and does not repair the interrupted
full-run per-file coverage report. CAP-BE-02 remains open for a clean, complete
regression/coverage gate on the exact source, preferably Linux CI; no thresholds
or tests were weakened. Shared deployment is not performed by this revision.

During test development, the new native fixture initially expected
AWAITING_DEPOSIT immediately after timeline approval, but the actual legacy fixture
is DRAFT. It also attempted to assert new commercial eligibility before creating a
commercial draft, while legacy proposals legitimately permit their existing deposit
flow. The test now explicitly converts to the commercial model before testing its
approval gate; implementation payment rules remain intact.

## Hand-off and remaining boundaries

[API, role matrix, examples and migration/client rollout](../../docs/couple-predeposit-app-access.md).
OpenAPI SHA-256:
`c3c6367a48ad31893f076a770a9ab3f135410c7f8e6a26b725fc68491e1752dd`.

The app team must adopt pre-deposit navigation and remove its local FULL-only
planning/proposal guard, using real booking capabilities instead. Frontend source
is untouched. Shared migration/deployment, exact-head CI, native UI and real
provider sandbox verification remain separate release gates.

## Subsequent owner-authorized server release

The owner subsequently requested deployment of this backend and migration to the
existing server. Exact-head Linux CI for PR #92 and its main merge passed all
314 files / 2,350 tests, 716 PostgreSQL integration tests and all coverage/audit
gates. This closes the earlier full-project verification gap without changing the
retained Windows-run results above. The controlled migration and exact deployed
HTTP checks are recorded in the
[separate server release evidence](./couple-predeposit-server-release-2026-10-23.md).
