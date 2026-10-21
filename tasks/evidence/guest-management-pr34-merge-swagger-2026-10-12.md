# SPEC-06 GM-W1-W4: PR #34 merge and Swagger verification

Date: 2026-10-12 (Asia/Saigon). Local post-merge evidence, created after the
tested/deployed commit; not included in that commit.

## Merge

[PR #34](https://github.com/WDP301-wedding/wedding-be/pull/34) was merged into main at 2026-10-11T23:33:42Z.
Merge commit: `4eee04447de048e615eac8214869b00ff0e4049c`.
Final PR head: `1648ebd6259940609ec636c570fe275e4524ef06`.
Both PR-head CI gates passed; no unresolved review conversations. The merge
preserves implementation commit `a6e79d73c55ba58a49876f8b0440c29ae74b75cf`
and the source pin in the provider manifest. Local main was updated by fast-forward.

The human explicitly requested merge and Swagger verification in this chat.
Independent team-member approval is absent and is not claimed. The owner's
instruction authorizes this merge; general CONTRIBUTING/CI policy is unchanged.

## Merge-commit CI and deployment

[Merge-commit Backend CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38184745109) passed both existing gates on the
exact source above, with unchanged test/coverage/audit thresholds.

- Unit: 1241 tests / 136 files.
- Contract: 39 tests / 13 files.
- PostgreSQL integration: 403 tests / 73 files.
- Full suite: 1683 tests / 222 files.
- Coverage: 97.44% lines / 93.61% branches;
  existing per-file 80% gates passed. No tests skipped.
- Dependency audit passed under the existing documented, unexpired exception
  1145093; no new dependency or new exception was introduced.

Railway deployment `7157feaf-f953-4e09-9893-63f1ba645ccc` is SUCCESS and serves the exact
merge commit. The deployment waited for main CI. Startup logs identify 45
migrations and successful migration deployment, including the new additive
Guest management migration. No provider configuration was changed.

## Deployed Swagger

Target: [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs), the previously owner-authorized
developer staging target whose Railway environment is labeled production.

- Canonical OpenAPI matches repository bytes exactly: SHA-256
  `4d162cdb766164e240a16c8bc53770a481cfa521491dae313f2971beba0cd63f`.
- 154 paths, 179 unique operations;
  all 1612 local references resolve.
- All 13 Guest management operations over 10 paths are present. Swagger's
  browser document uses the mounted /api/v1 prefix and matching components.
- 13 HTTP checks passed for docs, assets, OpenAPI, health and
  public hall GET; three anonymous private Guest/group/plan GETs denied with 401
  AUTHENTICATION_REQUIRED.
- A browser reload shows all 13 Guest operations. Swagger Execute of the public
  hall GET returned real 200; console errors/warnings: 0.
- All 17 verification request IDs matched exact-deployment logs.

GM-W5 remains pending. Swagger/migration success does not establish provider
live integration, downstream Seating/printing/event/invoice conformance or
production readiness. No frontend modification, new email, paid generation,
payment or authenticated shared-data mutation was executed.

Machine-readable receipts: [companion JSON](guest-management-pr34-merge-swagger-2026-10-12.json).
