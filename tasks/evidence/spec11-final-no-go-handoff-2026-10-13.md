# SPEC-11 completed backend hand-off and NO_GO decision

Date: 2026-10-13, Asia/Saigon. Candidate PR: [#40](https://github.com/WDP301-wedding/wedding-be/pull/40).
The owner reviewed and approved the previously summarized synthetic-demo NO_GO
package. [Human acceptance](spec11-rv21-owner-acceptance-2026-10-13.md) closes RV-21;
the [final API/provider and client checklist](../../docs/spec11-final-backend-handoff.md)
closes REL-W4. This decision/recovery record closes REL-W5 after those two tasks.
Execution order is preserved: REL-W1 → REL-W2 → REL-W3 → RV-21 → REL-W4 → REL-W5.

## Completion and release are distinct

**71/71 tasks in the current backend scope are complete.** This means the agreed
implementation, scoped evidence, review and release-decision hand-off tasks are
complete. The retained NTF-FCM-W4 live Android configuration/test/acceptance task
is owner-deferred, outside these 71 tasks, and remains unchecked. It resumes with
the app team. Full product integration and independent human PR approval/merge
remain separate; this record does not claim that PR #40 is merged.

**Backend release decision remains NO_GO; product release remains PENDING.**
The owner approved a truthful hand-off with limitations, not a GO waiver. Required
runtime/provider gates are retained. No worker, provider, database or deployment
operation was run to close these documentation/decision tasks.

## Immutable candidate and re-evaluation

Reviewed executable source: `d0001d93e52dd392d7b2b5873ebbbf664084958d`.
API SHA-256: `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`;
218 routes, 60 unchanged migrations. The original
[reviewed manifest](spec11-release-manifest-demo-rebuild-2026-10-13.json) and
[pre-review package](spec11-release-review-demo-rebuild-2026-10-13.md) retain their
observed timestamps, 68/71 task snapshot and original blockers.

The additive [final decision JSON](spec11-final-no-go-handoff-2026-10-13.json)
re-evaluates that reviewed candidate using the unchanged release policy, the actual
owner-review receipt and the completed task tracker. It verifies candidate source
content, original receipt hashes, API and final hand-off hashes. It is explicitly
an acceptance overlay on the reviewed immutable candidate, not a fresh current-HEAD
CLI manifest or new runtime/provider receipt. Later publication commits affect
documentation only and do not replace executable or runtime identities.

RV-21 and REL-W4 completion blockers are resolved. The following **eight release
blockers remain**, with no altered provider status or source revision:

- `WORKER_REQUIRED`: the recorded email worker is off after the approved budget.
- `journey.no-names`, `journey.partial-names`: native journey receipts keep the
  historical executable source rather than asserting a run of this candidate.
- `migration.empty-upgrade`, `staging.runtime`, `staging.recovery`: exact-source
  gate matching remains enforced; the preserved observations are from the prior
  source and scoped recovery amendment.
- `provider.revised-journey`: revised-candidate provider acceptance remains pending.
- `workers.runtime`: the historical delivered messages do not prove a recurring
  worker on the reviewed candidate with its current disabled configuration.

Historical runtime/provider source remains
`e8e7945548ac40d8308a5e4841fc0314c2d40276`. Prior journeys, two Brevo deliveries,
signed VNPay sandbox balance settlement/replay and native erasure/ledger restore
retain their original evidence. No old observation is relabeled as new PASS.

## Quality, recovery and operating hand-off

[Reviewed-candidate Linux CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38339080975)
passed both jobs: 1,878 tests across 265 files, including 490 PostgreSQL integration
tests, unchanged per-file coverage gates, build, typecheck, lint, OpenAPI and the
existing documented dependency-audit exception. Windows full-run cleanup/worker
limitations and the successful sequential 13-test retry are preserved in RV-21.
This closure changes documentation/artifacts only; no repeated runtime claim is made.

Recovery owner: **Lê Bá Bách**. The dedicated synthetic-only staging/demo may be
rebuilt in a new isolated database from immutable migrations and native seed;
no ongoing 30-day backup retention is required in this selected scope. Follow the
[operator procedure](../../docs/spec11-recovery-operator.md#selected-demo-rebuild-procedure):
close traffic, preserve diagnostics/provider UNKNOWN facts, keep dispatch disabled,
review/fence the new target, use a new checkpoint, verify migration/auth/privacy/
money/readiness invariants and review reopening. Existing staging was not reset.

Email budget is exhausted; worker and FCM stay off. Any future GO evaluation must
obtain actual exact-candidate runtime/provider/worker evidence within an authorized
test scope. Production, real money, paid generation and shared-data recovery require
their own scope. Frontend/app integration uses the separate checklist in REL-W4;
its unchecked client items are not reported as backend tests or live push proof.
