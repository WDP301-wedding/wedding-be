# BE-17 PR #33 merge and deployed Swagger verification

Date: 2026-10-12 (Asia/Saigon). This is local post-merge evidence, created after
the tested/deployed commit. It is not part of that commit.

## Merge and acceptance

[PR #33](https://github.com/WDP301-wedding/wedding-be/pull/33) was merged into
`main` at 2026-10-11 21:19:37 UTC / 2026-10-12 04:19:37 Asia/Saigon.
Merge commit: `07e4457b946e61c45e1f4e599a17de4467488ee8`.
The final PR head was `d7d156b0de23459aac39a74d099c805ae9dc1574`.
Both CI jobs passed before merge, with no unresolved review conversations.

The [explicit owner instruction](be11-17-owner-acceptance-2026-10-12.md)
waived another team member's review/approval for this closure and merge.
Independent team-member approval is absent and is not claimed. General review
policy and backend CI gates were not changed.

The merged todo records **BE 17/17 complete for backend developer scope** and
**RV 18/21 complete**. RV-16 (actual Notifications workers), RV-19 (real Seating
print integration) and RV-21 (release/runtime/recovery checkpoint, including
REL-W3) remain open. Their remaining work is not a forgotten checkbox.

## CI and deployment

[PR-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38175296731)
passed both jobs. [Merge-commit CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38175897931)
passed both jobs after a bounded failed-job rerun, attempt 2, on unchanged source.
The successful quality job was retained by GitHub's failed-job rerun.

| Gate | Verified result |
| --- | --- |
| Static/build/API/audit gates | Pass |
| Unit | 1,234 tests / 134 files |
| Contract | 37 tests / 12 files |
| PostgreSQL integration | 382 tests / 68 files |
| Full suite with PostgreSQL | 1,653 tests / 214 files |
| Coverage: statements / branches / functions / lines | 96.51% / 93.56% / 98.48% / 97.33% |
| Per-file branches and lines | Existing 80% thresholds passed |

Attempt 1 failed in Vitest coverage-v8 `writeCoverageFile` with `EBADF` during
write/close; coverage lacked `bootstrap-secret.ts` and reported 213/214 files,
1,650/1,653 tests. Its separate integration run passed all 382 tests. A focused
local diagnostic passed four bootstrap-secret tests; focused-only coverage
threshold overrides were diagnostic, not acceptance evidence. The complete CI
rerun retained all tests and original thresholds and passed. This does not claim
the intermittent descriptor failure's root cause was repaired. Sanitized failure
metadata remains in the companion JSON; raw logs stay in ignored local files.

Railway skipped initial auto-deployment `35e8e017-5df8-4643-a6f8-8e56309f9690`
after CI failed, retaining the previous running deployment. After exact-source
CI passed, an explicit deployment of the same merge commit completed:
`b71e6a8f-4cbf-4dfe-b6c1-e52f4259d914`, status `SUCCESS`, active commit
`07e4457b946e61c45e1f4e599a17de4467488ee8`. No provider configuration or Wait
for CI setting was changed. Startup logs report 44 migrations and no pending
migrations.

## Deployed Swagger

Target: [Swagger](https://wedding-be-production-e1dc.up.railway.app/docs), the
owner-authorized developer staging target with Railway environment label
`production`. Verification occurred after the new deployment became active.

- `/docs`, both OpenAPI endpoints, Swagger assets/fonts, health live/ready and
  the public hall GET returned 200: 13 HTTP checks.
- Canonical deployed OpenAPI exactly matched repository bytes, SHA-256
  `55c15733cdc25a9151c724e311cb5753f9b41124a15c879cf73cc3c90c108b9e`.
  There are 144 paths, 166 unique operations, 73 schemas and 1,525 resolved
  references. All 49 commercial/related operations are present.
- Swagger's paths match the canonical document with the mounted `/api/v1`
  prefix; components match and the selected server is `/`.
- Five anonymous private contract/appendix/invoice/expense/print-file GETs
  returned 401 `AUTHENTICATION_REQUIRED`.
- A browser reload displayed contract, appendix, contract PDF, final invoice,
  services and print-offering routes. Swagger Execute performed
  `GET /api/v1/catalog/halls?limit=20` and displayed a real 200 response with
  request ID `85470b0a-10b3-456a-a74a-c5abf826ba64`. Browser console had no
  errors or warnings.
- All 19 HTTP/browser request IDs were found in the exact deployment's logs.
  The printable PDF response content/header contract was checked in OpenAPI;
  no new authenticated print or commercial mutation was executed.

Application source, tests, dependency lockfile, all migrations and generated API
remain unchanged from runtime baseline `054d670d6a7edd4d8028004271b02fab5c60973f`.
No frontend changes, new email, paid generation, payment or shared-data write
were performed. Swagger success and this review exception do not establish
production readiness or close RV-16/19/21.

Machine-readable receipts: [companion JSON](be17-pr33-merge-swagger-2026-10-12.json).
