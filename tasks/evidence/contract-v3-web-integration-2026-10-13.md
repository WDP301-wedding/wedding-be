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
run passed. These failed attempts are not acceptance runs.

Mutation check: invert the newly added empty-plan condition, run the current-plan
HTTP regression, observe 200-vs-404 failure, restore the exact original source in
`finally`. The test catches this mutation.

The full local Windows coverage attempt timed out in pre-existing runtime CLI and
media concurrency tests and was stopped; no full local pass or coverage result is
claimed. Exact-source Linux CI must run the repository's unchanged full gates.
The broad local lint scan also traversed pre-existing untracked output; changed
TypeScript files were checked independently. Final static/targeted and CI results
are recorded below after completion.

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

Pending final static/targeted run and exact-source Linux CI. Do not treat this
checkpoint as a completed full-suite or release acceptance until recorded here.
