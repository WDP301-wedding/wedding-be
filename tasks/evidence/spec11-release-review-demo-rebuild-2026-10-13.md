# SPEC-11 synthetic demo release review (RV-21)

Date: 2026-10-13, Asia/Saigon. This additive package preserves all earlier immutable
manifests and provider receipts. Candidate: [PR #40](https://github.com/WDP301-wedding/wedding-be/pull/40).

## Identity and decision

Source: `d0001d93e52dd392d7b2b5873ebbbf664084958d` (committed clean candidate at generation).
API SHA-256: `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`; 218 routes;
60 unchanged ordered migrations. The [immutable manifest](spec11-release-manifest-demo-rebuild-2026-10-13.json)
pins source-file, migration and evidence hashes, runtime/provider modes and route security.
Publishing this package afterward does not claim another runtime/provider test.

Recovery: **REBUILD_SYNTHETIC_DEMO / MIGRATIONS_AND_SEED**, synthetic-only dedicated
Railway staging/demo, owner Lê Bá Bách. No 30-day backup retention is required for
this selected scope. Production rejects this exception. No database was reset.
See the [owner scope record](spec11-demo-rebuild-scope-2026-10-13.md) and
[recovery procedure](../../docs/spec11-recovery-operator.md#selected-demo-rebuild-procedure).

Backend decision: **NO_GO**. The exact blockers are:

- `WORKER_REQUIRED`
- `RV-21`
- `REL-W4`
- `journey.no-names`
- `journey.partial-names`
- `migration.empty-upgrade`
- `staging.runtime`
- `staging.recovery`
- `provider.revised-journey`
- `workers.runtime`

REL-W3 and deferred NTF-FCM-W4 are absent from this blocker list. RV-21 and REL-W4
remain prerequisites. Required exact-source evidence is still enforced: the
preserved native journey/migration/runtime/provider receipts identify
`e8e7945548ac40d8308a5e4841fc0314c2d40276`, not this newer release-policy commit.
The revised-provider gate remains pending. Actual Brevo/VNPay observations remain
valid historical evidence, not new PASS receipts. The email worker is off after
the two-email budget was exhausted; FCM is off and app-device acceptance is deferred.
An owner review of this NO_GO record does not authorize new emails, paid generation,
real-money payment, a shared-data reset, production deployment or a false GO claim.

## Verification

[Exact-source Linux CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38339080975) has both jobs successful: static checks,
unit/contract tests, OpenAPI check, build, existing dependency-audit policy,
empty migration deployment, integration and full-suite per-file coverage.
Full suite: **1,878 tests / 265 files**, including **490 PostgreSQL integration
tests**. Coverage: statements 96.59%, branches 93.45%, functions 98.43%, lines 97.5%.
The existing unexpired dependency exception 1145093 remains recorded; there is no
new waiver. Local release tests: 25 pass with 100% module coverage; 18 are release
policy tests including the new production rejection. Inverting the staging guard
failed the regression suite, then the exact original source was restored.

Local Windows verification is recorded separately. An initial direct `npm test`
without PostgreSQL failed configuration/connection gates; no PASS is claimed for
that run. The configured full disposable run reported 1,873 passed, one cleanup
timeout, another suite cleanup timeout and two native worker exits
(3221226505), rather than a full PASS. The four affected files pass when rerun
sequentially in their own disposable database: **13/13 tests**.
No tests, coverage thresholds or timeout gates were changed to hide those results.

Read-only staging observation at 2026-10-13T02:45:12.892Z: readiness 200,
OpenAPI 200, bytes match the API digest above. This proves readiness/schema
publication at that time, not the new candidate's runtime/provider acceptance.
Two native staging journeys, exactly two delivered emails, signed VNPay sandbox
balance settlement/replay and protected native-erasure restore are retained in the
[prior checkpoint](spec11-staging-checkpoint-2026-10-13.md).

## Acceptance and hand-off

Current scope: **68/71 backend tasks complete**. REL-W1/2/3 are closed; RV-21,
REL-W4 and REL-W5 remain open in the requested order. NTF-FCM-W4 is retained as a
future app-integration task and is excluded from the current 71-task scope.

RV-21 requires the project owner's review of this exact identity, feature modes,
evidence boundaries, unresolved gates and selected demo recovery. Its review
may accept a truthful NO_GO hand-off; it cannot turn pending provider/runtime
gates into PASS. After that review, finalize the immutable API/provider manifest,
[frontend integration checklist](../../docs/backend-release-spec11.md#api-and-frontend-integration-checklist)
and NO_GO/recovery hand-off as REL-W4 then REL-W5. Frontend/native configuration,
builds, device push tests and full product integration remain separately owned.
PR merge additionally needs another team member's approval under CONTRIBUTING.md.
