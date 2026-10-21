# SPEC-08: PR #36 merge and Swagger verification

Date: 2026-10-12 (Asia/Saigon). Local post-merge receipt; not committed or part of the tested/deployed source.

[PR #36](https://github.com/WDP301-wedding/wedding-be/pull/36) merged at 2026-10-12T04:57:26Z, commit
`376435941e8e876e16c7caa07855d234dc65338d`, final head `24666301c9792156784091b4aa4d4ceea9a3c272`.
Both exact-head CI jobs passed before merge; no unresolved review threads or requested
changes were present. Human merge authorization is not independent team approval.
Local main fast-forwarded, with existing untracked work preserved.

Merge-commit [CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38205884398) passed all existing gates on attempt 2.
Attempt 1 hit the public ECR data limit while pulling PostgreSQL before checkout/tests.
Rerun recovered without source or gate changes. Unit 1,250 / contract 41 / integration
431 / full-suite 1,722 tests pass; coverage 97.42% lines / 93.32% branches, unchanged
80% per-file gates. All 47 migrations deployed to the empty disposable CI PostgreSQL.

Railway skipped the original automatic deployment after failed CI. After CI success,
a service-scoped redeploy from configured main source created
`73b0616a-d4db-4b3a-854f-9bc9057bba27`: SUCCESS on the exact merge commit. Logs confirm
`20261012030000_staff_operations` applied successfully. Source connection, Wait for CI
and provider configuration were preserved. This is the developer staging target
authorized in the runbook, despite its production environment label.

[Deployed Swagger](https://wedding-be-production-e1dc.up.railway.app/docs) verification:

- Canonical bytes match repository SHA-256 `8be62bc16348dbe60fed7c8482384beb8ba16bd9cf9d02f85a1995dd13b00f2b`.
- 169 paths / 197 unique operations / 1,713 resolved local references.
- All twelve Staff operations match browser schemas, bearer security and /api/v1
  prefixes; all twelve render under the Staff operations filter.
- 12 OpenAPI/docs/assets/health/catalog reads return 200; five anonymous Staff,
  owner and management reads return 401 AUTHENTICATION_REQUIRED with no-store.
- Browser console: zero errors and warnings.
- All 17 server-issued response request IDs match exact-deployment logs.
- Screenshot: ../../output/playwright/spec08-pr36-swagger.png.

This proves deployment and Swagger publication, not authenticated Staff workflows,
live email/storage/generation/payment integration or whole-release readiness.
No business-data mutation, paid generation, payment or email was executed during
verification; the authorized release migration is recorded separately above.
Named Guest check-in only; companion-count work remains deferred as confirmed.

Machine receipt: [JSON](staff-operations-pr36-merge-swagger-2026-10-12.json).
