# SPEC-07 / RV-19: PR #35 merge and Swagger verification

Date: 2026-10-12 (Asia/Saigon). Local post-merge evidence; not part of the tested/deployed commit.

PR [#35](https://github.com/WDP301-wedding/wedding-be/pull/35) merged at 2026-10-12T01:41:40Z, merge commit
`c66847706f6df19f5a65742478e0d83d5cff01e1`, final head `81f8255aaa869ccff3a6d51c0bbb768bbd75fb55`.
Both exact-head CI jobs passed; no unresolved review conversations or requested
changes. The human explicitly requested merge and Swagger verification; this is
merge authorization, not independent team-member approval. Local main fast-forwarded.

Merge-commit [CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38192880821) passed both existing jobs with unchanged
test/coverage/audit gates.
Unit 1,248 / contract 40 / integration 418 / full-suite 1,706 tests pass without skips;
coverage is 97.43% lines / 93.56% branches with existing per-file 80% gates.
Railway deployment `517b4e83-1eac-42d4-acbf-1fc48300c0fb` is SUCCESS
on this exact merge commit after Wait for CI. Logs identify 46 migrations and successful
migration deployment. No provider configuration changed.

[Deployed Swagger](https://wedding-be-production-e1dc.up.railway.app/docs) is verified on the previously authorized
developer staging target with Railway environment label production:

- Canonical OpenAPI matches repository bytes: SHA-256 `dbf4880f1f92a65ba503d9db0890b857e80e7fff46a6065a5d65ffbaf1ccc430`.
- 160 paths, 185 unique operations,
  1646 resolved local references.
- All six private Seating operations appear in HTTP OpenAPI and the reloaded browser.
  Swagger paths include /api/v1 and components match the canonical document.
- Printable file contract advertises invitation-a5-v1 and invitation-a5-v2-seating.
- 13 docs/assets/OpenAPI/health/public hall checks return 200;
  3 anonymous Seating/print reads return 401 AUTHENTICATION_REQUIRED.
- Swagger Execute of the public hall GET returns real 200; browser console issues: 0.
- All 17 verification request IDs match exact-deployment logs.

This verifies deployment and Swagger publication, not an authenticated Seating/print
journey, live payment/storage/generation/delivery or whole-release readiness. No
frontend edit, paid generation, payment, email or authenticated business-data write
was executed. Existing SPEC-07 native/CI/PDF evidence remains separate.

Machine receipt: [JSON](seating-plan-pr35-merge-swagger-2026-10-12.json).
