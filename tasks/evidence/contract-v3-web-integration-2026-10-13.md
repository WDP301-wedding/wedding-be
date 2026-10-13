# Contract v3 web integration backend extension — 2026-10-13

Authorization: the owner requested implementation after the four questions in
`wedding-web/docs/contract-v3-integration.md` and the email-fragment mismatch were
reviewed in this chat. Backend-only; baseline SPEC evidence remains unchanged.
Base: `main@ff0c44262a1d5b3bf80cd14680d44f9e647b0812`.
Branch: `codex/contract-v3-integration-fixes`.

## Implementation and acceptance boundaries

- Email links use `#credential=wgc_...`; controlled delivery parses the fragment
  like the frontend and exchanges it through real Guest HTTP owners.
- GET personalized-invitations returns latest revision/expiry/revocation metadata
  to Manager/owning FULL Couple only, without raw credential recovery or issuance.
- GET seating-plans/current discovers the one current Booking plan, returns null
  before selection, and shares the existing individual-plan revalidation path.
- Strict schemas/OpenAPI and [client hand-off](../../docs/contract-v3-web-integration-follow-up.md)
  document errors, access, concurrency, null/zero states and configuration limits.
- No migration, frontend source, money, planning count, named attendance mode,
  approved document or historical acceptance checklist was changed.

Generated OpenAPI SHA-256:
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.

## Local verification

The existing `scripts/staff-operations.verify.mjs` creates its own disposable
database under `127.0.0.1:55435`, applies all 60 immutable migrations, and supplies
isolated runtime/migration URLs. No shared provider DB is used by these tests.

RED: the email/parser test and both HTTP discovery tests failed against the
original code (missing metadata GET; `current` treated as an invalid UUID;
email credential parameter absent). GREEN targeted runs cover authorization,
revoked sessions, foreign Guests, restricted access, strict queries, never-issued,
expired/revoked metadata, repeated issuance and latest plan discovery/revisions.
The immutable credential expiry guard rejected an invalid test fixture update;
the fixture was corrected to create separate expired evidence without weakening
the guard. One Windows worker process exited unexpectedly; a subsequent isolated
run passed. A later combined Windows fork run also exited with native worker
errors. These failed attempts are not acceptance runs. The final targeted run with
the pinned Node 24.21.0 and a single threads worker passed all 17 tests in five files.
Changing the runtime and pool together does not establish which caused the earlier
native failures; this is successful bounded verification, not a claimed platform fix.

Mutation check: invert the newly added empty-plan condition, run the current-plan
HTTP regression, observe 200-vs-404 failure, restore the exact original source in
`finally`. The test catches this mutation.

The full local Windows coverage attempt timed out in pre-existing runtime CLI and
media concurrency tests and was stopped; no full local pass or coverage result is
claimed. Exact-source Linux CI must run the repository's unchanged full gates.
The broad local lint scan also traversed pre-existing untracked output; changed
TypeScript files were checked independently. Final static/targeted and CI results
are recorded below.

## Runtime configuration and bounded IP probe

Target: documented Railway developer environment `production`, service
`wedding-be`, project `1c56721d-021a-442c-9e01-bb91abe73adb`.
Active release during inspection: `9db02301-b4b4-4641-97db-e211f7e95abe`,
source `ff0c44262a1d5b3bf80cd14680d44f9e647b0812`.

- Existing VNPay return URL already pointed at `/payment-return` on the public web.
- Missing `NOTIFICATIONS_GUEST_LINK_URL` was saved as
  `https://wedding-web-silk.vercel.app/invitation/personal` with `--skip-deploys`.
  Readback matches; activation waits for a separately approved deploy/restart.
- `AUTH_TRUST_PROXY_HOPS=1` remains unchanged.

Two bounded probes sent a total of eight invalid Guest exchange requests to the
direct backend and Vercel proxy, with/without reserved documentation IP headers.
Every request returned 404 `INVITATION_LINK_UNAVAILABLE` and changed two hashed
short-lived rate-limit counters. Read-only DB comparison retained no raw IP,
credential or user contact data. Direct plain/forged requests used equal buckets;
Vercel buckets differed from the direct client and between proxy requests.
The second probe explicitly checked the forged-address hash: no request resolved
to that address. Bucket changes alone do not prove the exact forwarded chain or
collisions between distinct clients. Original client IP through Vercel remains a
documented integration gate, requiring hosting/frontend coordination.

No paid generation, payment transaction, real email, Guest capability, business
record mutation, destructive data operation or new code deployment was performed.
Provider delivery, PR approval/merge, deployment and product GO remain separate.

## Final verification

- Local `npm run typecheck`, `npm run build`, `npm run api:check`: passed.
- Changed TypeScript lint (including the corrected contract-test unknown type),
  changed document/test formatting and `git diff --check`: passed.
- Final targeted command using the SHA-256-verified official Node 24.21.0 binary:
  `node scripts/staff-operations.verify.mjs tests/integration/notification-guest-delivery.test.ts tests/integration/guest-management-http.test.ts tests/integration/seating-plan-http.test.ts tests/contract/guest-management-openapi.test.ts tests/contract/seating-plan-openapi.test.ts --maxWorkers=1 --pool=threads`:
  **17/17 tests, 5/5 files passed**, all 60 migrations applied on disposable local PostgreSQL.
- [Exact-source Linux CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38427580014)
  on `0613751b66c4fa698e24810a8cf9fc0e94dc992d`: both jobs succeeded.
  Static formatting/lint/typecheck/build/API/audit gates passed; 1347 unit tests,
  47 contract tests and 495 PostgreSQL integration tests passed.
- Full PostgreSQL coverage: **1889 tests in 265 files passed**. Overall lines
  97.5%, branches 93.44%; existing per-file 80% line/branch thresholds unchanged
  and passed. The existing dependency audit policy was not changed.
- Review examined ownership/concurrency, concealed foreign identities, no raw token
  recovery, bounded indexed reads, shared seating revalidation and immutable evidence.
  The empty-plan mutation was caught; no source/dependency/migration changes remain
  outside the requested scope.
- [PR #44](https://github.com/WDP301-wedding/wedding-be/pull/44) contains the backend
  extension and final hand-off. Later documentation-only commits retain this code/API
  identity; current-head check results are visible on the PR. Team review, merge,
  deployment/configuration activation and live provider acceptance remain separate.

## Owner-authorized merge-policy amendment

After approving the PR #44 review exception, the owner explicitly instructed this
chat to remove the mandatory "at least one approval from another team member"
requirement before merge and Railway deployment. The backend contributing guide,
PR template, scope amendment and cross-repository/deployment guidance now make
teammate approval optional for `wedding-be`. Change review, resolved conversations
and exact-head CI remain required. No frontend policy or historical reviewer
approval is changed or claimed. The owner authorized PR #44 merge/deployment;
the updated policy and all implementation changes must pass final-head CI first.

GitHub inspection: `main.protected=false`, classic protection GET returned 404,
rulesets GET returned 200 with an empty list. No server-side approving-review
requirement exists to remove; no CI/protection setting was weakened. Previous
private-plan 403 notes remain historical evidence.
