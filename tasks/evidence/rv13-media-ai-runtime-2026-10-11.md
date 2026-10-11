# RV-13 → RV-08 → RV-09 → RV-10 → RV-11 runtime rehearsal

Date: 2026-10-11, Asia/Saigon. **RV-13 → RV-08 → RV-09 → RV-10 → RV-11 passed**
on the named developer environment. The real
Supabase duplicate-status defect was fixed in
`afedb12a10f1b1d7d196fc8bb97b97e56138efe1`, validated by CI and deployed for this
test. Draft [PR #28](https://github.com/WDP301-wedding/wedding-be/pull/28) remains
open for team review; this is not production readiness or approval to merge main.
Redacted receipts, checks and final-state assertions are in the
[machine-readable evidence](rv13-media-ai-runtime-2026-10-11.json).

## Authorization and target

The owner requested these five tasks in this order. Use the previously authorized
developer-only Railway/Supabase environment, not real customer data. The owner
separately approved **one new Gemini generation, maximum USD 0.10, generic floral
prompt without personal data and no repeat on timeout** in this chat. That new
authorization was consumed exactly once at 07:56:23 UTC, with zero retries.
Recovery tests issued zero additional Google generations. The earlier request remains
the separate historical test documented in [the prior report](rv10-gemini-railway-2026-10-11.md).

- Project: `1c56721d-021a-442c-9e01-bb91abe73adb`.
- Service: `0f70d648-8c59-48bd-84f3-29a86d2e2d38`.
- Environment: `08a2899c-b0d6-4200-a505-604965a4b3fc`, named `production`,
  previously designated by the owner as a developer test environment.
- RV-13 and original media round-trip source:
  `5d6cb42211bbce54c1493d8c8d193d7c3450e995`, BE-06–10 merged in PR #27;
  deployment `6f92c2b5-aca7-4da8-b4b8-27b1ab999a2b`.
- Subsequent recovery/publication/Gemini source:
  `afedb12a10f1b1d7d196fc8bb97b97e56138efe1`.
- Active successful test deployment: `2ede59de-f5f5-4ea7-bb7a-a05a81078ea9`.
- Target: `https://wedding-be-production-e1dc.up.railway.app`.
- Canonical OpenAPI SHA-256:
  `b82ecfbb8995125178d5676347917aeaf232c48a231be9ef929e71a9c564a8df`;
  HTTP 200 and exact bytes match the current repository.

Read-only runtime inspection confirmed Gemini configuration selects
`gemini-3.1-flash-lite-image`, private Storage configuration is present, and
`PUBLIC_INVITATION_ORIGIN` was initially absent. Set only this variable to the
target HTTPS origin; unrelated variables were unchanged. No provider feature is
accepted by configuration observations alone. Temporary operator access and scripts
are outside committed source; tokens, provider keys and signed checkout URLs
must remain private.

Uploaded only a `git archive` snapshot of the CI-passing fix commit. Archive SHA-256:
`bb1b266ce26828a032a477f75e860e4565470201278ee7c4991b9e3784087bd8`.
The CLI deployment does not supply `RAILWAY_GIT_COMMIT_SHA` (runtime value null);
source attribution is the uploaded immutable archive plus exact compiled hashes,
not a fabricated runtime Git value. The deployed Storage adapter hash is
`3360bf212c5ad67bb0367c4ad8a8d17e32c48f781fc2374e40d850bacba524de`, matching the
local build. Gemini and GenerationService hashes remained respectively
`2e30d224b09c5cb816a68813f677ebcf28a2b29510679f695dc8ddc5f10c94b7` and
`ba0c661ad0cb79d0723113bea24b35eae3344a10a3231309835268499f6ed2c5`.
Service source is still `WDP301-wedding/wedding-be`, branch `main`, with
`checkSuites: true` (Wait for CI); before/after source settings are identical.
No migrations were added or changed. Existing pre-deploy migration/readiness gates
ran normally before deployment SUCCESS.

## RV-13 revised full-contract preparation

Preserved the original genuine sandbox settlement and its immutable ledger history
from [the baseline rehearsal](rv12-13-vnpay-railway-2026-10-11.md). Created a separate
synthetic consultation and booking through the deployed Manager API. Names are
explicit synthetic bride/groom values, not parsed from a legacy display label.
No email was sent.

- New booking: `28014903-2a3e-4738-bdb8-7a1146b8ebbb`.
- New consultation: `9f0fe66a-a87f-415a-8d9b-7eae3ae6d5a3`.
- Event slot: synthetic Lotus Hall, 2027-01-05, DINNER, distinct from the old booking.
- Controlled prerequisite: attached the existing sandbox Couple identity with
  `RESTRICTED` consultation access in a transaction audited as
  `test.rv-chain.access-fixture`. This is not a live invitation-delivery test.
  No payment, settlement, confirmation or FULL access was seeded.
- Manager and Couple approved the exact new timeline through normal HTTP APIs.
- Created an isolated invitation template, print offering and MC service through
  normal APIs. The full commercial contract has two distinct menu selections,
  20 print copies and one service session. Submission and both commercial
  approvals were actual authenticated HTTP operations.
- Server-calculated contract total: **8,110,001 VND**.
- Server-calculated deposit: **2,433,001 VND**,
  `ceil(8,110,001 × 30 / 100)`. The deliberately non-round total exercises upward
  integer rounding across menu, print and service lines.
- Slot hold and deposit intent were created through normal HTTP APIs.
- Attempt: `4944d53f-945a-4a13-b549-ae6538e7883e`.
- Checkout returned HTTP 201, request
  `3efdf412-701c-4221-90d6-5a07725c5e09`; its signed URL targets the VNPay sandbox
  and carries the matching integer amount.

The provider-hosted NCB test checkout visibly displays the new attempt and
2,433,001 VND. Only VNPay's [public sandbox test card](https://sandbox.vnpayment.vn/apis/vnpay-demo/)
was entered. The provider then requested “Đồng ý & Tiếp tục” for service terms.
The owner approved the terms. The first checkout expired while waiting (provider
response 15). Its real signed return was explicitly replayed through the callback
handler to resolve failure; this replay is not claimed as a genuine IPN. A status
read confirmed FAILED before reacquiring the slot and creating a replacement.
No database payment state was reset.

Replacement attempt `56966cdd-c997-4106-a404-351226378a0e` completed the provider-hosted
NCB test-card/OTP flow. Before any success replay, the database contained genuine
IPN receipt `78fb6471-843d-496c-aa9e-a9d47bfc3de1`, ACCEPTED/SUCCEEDED, transaction
`15701311`, 2,433,001 VND, payload hash
`e02e91a101f729ae9e40260f190f404716dbc3097824ab0f7815429044d149b6`.
Authorized status read returned SUCCEEDED/application SUCCEEDED. Booking revision
14 is CONFIRMED, with matching current/effective timeline
`195bd9d7-212c-4737-a42e-9b0561753b1c`. The same Couple account has FULL access.
Exactly one CHARGE (8,110,001 VND, approved contract
`d0f57cda-6c7f-4148-bde5-be0ed42b9347`), one PAYMENT (2,433,001 VND) and one deposit
application exist. QueryDr at 07:32:58 UTC verified its signature, matching attempt,
amount, transaction and SUCCEEDED outcome. Replaying the provider's actual success
parameters returned HTTP 200/RspCode 02; subsequent read-only ledger counts stayed
one CHARGE and one PAYMENT. The failed first attempt never confirmed the booking.

Local IPv6 connectivity became unavailable during verification. Read-only SQL
evidence was collected through the named Railway runtime's native database client,
preserving configured TLS verification. No certificate check was disabled.

## RV-08 observed Storage recovery defect

Actual deployed Couple HTTP upload, signed read/full pixel decode, replacement,
stale-revision 409 and detach passed for synthetic media
`afd3b2b3-e4ec-49e2-aa99-b592bb531a90` (revision 3). Retained original file
`b5ffc6d7-2987-44f9-83a4-5110f6238dd8` remained readable, hash
`cfe1d82b3b58b0c2a413d76f6cb2fff9057c084cb510c85cf549bd9e02881ce1`.
Unauthenticated preview/upload returned 401; unsigned private Storage read 400.
Derived asset/design was created before replacement/detach and retains the source.

The staged real-service interrupted-upload run revealed that the Storage SDK
returns `status: 400`, `statusCode: "409"`, `StorageApiError` for a duplicate
content-addressed object. The existing adapter selected `status` first, so retry
failed with PROVIDER_ERROR despite the existing object's matching metadata.
This matches [Supabase's standard upload documentation](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
The fix prefers the semantic storage code; it still validates exact checksum,
purpose, booking resource, MIME and size and never overwrites the object.
Two regression tests first failed on the real response shape. After the fix,
40 Storage tests passed, including mismatched metadata rejection. CI passed
before test deployment. First harness output also
encountered BigInt JSON serialization; the private harness now records progress
durably and serializes counters as strings. These incomplete fault runs do not
close the recovery acceptance gate by themselves.

After deployment, the staged real Storage run put an isolated synthetic PNG then
injected PROVIDER_UNAVAILABLE/503 before application acceptance. A fresh native
owner composition retried the same intent, recovered asset
`fbd8555e-5954-4900-bbee-13516791eeb0`, verified stored bytes/checksum and replayed
the accepted result. Durable upload journal `a48c6309-545e-44b5-993c-b708bd7ba206`,
sequence 7, records hash
`ecd6212405eb80ede6525f93e02ea4c7c7ac634739a799b4fe9b119b97570e72`.
Initial real put count 1, Google generations 0, Storage deletes 0. Retained design
revision `173d9ba4-b04d-4d7e-8a16-0ed97079d8a2` and original remain intact.

## RV-09 public invitation and generic QR

Published the exact retained derived revision through the canonical authenticated
Couple endpoint. Public identity `164adfbe-bf89-4db3-a1d3-23ac4692706e`, frozen
published revision `e042f426-db70-4da3-a74e-7b280587cf69`. Actual routed anonymous
JSON, Vietnamese HTML, PNG asset and QR all returned 200. Fully decoded PNG pixels
and QR payload; opening the decoded URL returned the exact same HTML on the
configured HTTPS origin. Public JSON contained no private object key, original
media ID, checksum, signed URL, token, guest response or check-in authority.

Editing the current draft afterward did not change the public snapshot. Private
invitation library without authentication returned 401. Unpublish through the
canonical API returned 200; JSON, HTML, QR and the previously published asset route
then each returned concealed 404. Private retained originals and immutable derived
design history were preserved. The QR is generic to the publication, not a guest
credential. No guest response endpoint or frontend code was added.

## RV-10 one authorized live Gemini generation

The compiled real Invitation router and native owner services ran in an ephemeral
loopback HTTP listener inside the selected Railway container, with the real
Gemini SDK and configured private Supabase Storage. An injected client adds
test-specific cost controls: one dispatch, SDK attempts 1, 10-second provider
timeout, one candidate, maxOutputTokens 3000, minimal thinking and no thoughts
returned. Local and remote exclusive dispatch guards were used. Model metadata,
prompt token count, exact deployment and compiled hashes were checked before
dispatch. These controls do not add a permanent budget cap to the canonical
generation endpoint; do not interpret this smoke test as production cost policy.

- Model/version: `gemini-3.1-flash-lite-image`.
- Prompt: generic ivory/pale-pink watercolor flowers, empty center, no people,
  text or personal data; no wedding photo was sent.
- Provider response correlation: `KEHLaqj_AfP6-8YPrqCDqA8`; finish STOP, image/jpeg.
- Measured generation calls: **1**; automatic retries **0**. The same intent replay
  through the guarded compiled HTTP router returned 201 without another call.
- Usage: 28 prompt tokens, 1465 output tokens (1120 explicitly image), 1493 total.
- Conservative pre-dispatch bound at 3000 output tokens: **USD 0.090007**.
  Conservative observed-usage estimate charging every output token at the highest
  output rate: **USD 0.043957**. This is a token-based estimate, not a billing receipt.
  Pricing source: [Google Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Accepted media asset `8f633f59-ba83-4d5b-8697-6f0b921aee75`, file
  `4b31655a-7a9c-4025-a223-bb98e780ba37`: image/png, 896 × 1200, 1,758,416 bytes,
  hash `85fd14af6029595e8f5d54374a2de85e142c95da473267c7f82fb10a9202db6f`.
- Durable generation intent
  `bb8e715c8ee5ab57f686177a5df13b28eb813fe25e3eee539a2c98deccaea08f` is ACCEPTED.
- Canonical HTTPS media read returned a signed private URL whose bytes matched
  the stored hash and were fully pixel-decoded; unauthenticated read returned 401.
  Actual HTTPS derived-asset and design creation returned 201. Usable design
  revision `7df12d1c-1e47-4942-bc61-78923e855dc9` was read back exactly with HTTP 200.

## RV-11 staged recovery

Fault transports use synthetic generated output and the real deployed application
services/database/private Storage. They never instantiate or call a Google client.
The unknown-response run returned PROVIDER_TIMEOUT/504; a newly constructed owner
composition retried the same intent and returned AI_GENERATION_PENDING/503, with
one measured synthetic generation and zero real generations. Intent:
`37cdde9bb5750e99bccf8e4e9d356416ba951ac440bd5b6f71d4170839e6d0e9`.
The Storage-after-generation run produced controlled PNG pixels, performed one
real private Storage put, then injected PROVIDER_UNAVAILABLE/503 before acceptance.
Rebuilding the owner services and retrying the same intent read the durable object
and accepted asset `db682099-6f4f-4585-bad4-62ba5c49c080`. Exact checksum/read and
semantic replay matched. Upload journal `8bb58c09-1d38-48e7-a879-44c19a52c377`,
sequence 12, hash
`308223d4e67e2175292e4e3123ff859c157f0504120c6b3505a2032773279b47`.
Measured controlled generation calls 1; initial real put calls 1; Google calls 0;
Storage deletes 0. An earlier private harness comparison incorrectly used JSON
property order against a JSONB receipt; its SSH collection timed out. The durable
report showed the comparison failure after asset recovery. Corrected the harness
to compare semantic values and persist call counters, then completed the isolated
synthetic rehearsal. The paid Gemini intent was never replayed or regenerated.

Canonical HTTPS Manager rehearsal: scoped pending list 200 with no prompt; Couple
pending/reconcile requests concealed 404; unsafe forceRetry field rejected 422.
Manager abandon returned 200, same-key replay 200, fresh stale reconcile 409.
Read-only native database inspection confirmed FAILED/AI_GENERATION_ABANDONED/502,
zero upload journals for that unknown intent, and exactly one attributed
`invitation.image-generation-abandoned` audit entry with the controlled evidence
reference. After rebuilding services again, retry of the abandoned generation
returned AI_GENERATION_ABANDONED/502 with **zero** controlled provider calls and
zero Google calls. This verifies durable recovery, authorization and audit rather
than treating the seeded timeout as a real Google outage.

## Offline verification

Executed existing tests against disposable local PostgreSQL on `127.0.0.1:55435`:

```text
node .local-demo/run-backend-tests.mjs \
  tests/integration/invitation-studio/media-persistence.test.ts \
  tests/integration/invitation-studio/studio-waves.test.ts \
  tests/integration/payments-billing \
  --maxWorkers=1 --testTimeout=30000 --reporter=json \
  --outputFile=.local-demo/rv-chain-offline-tests.json
```

**23 suites, 152 passed, zero failed, zero skipped.** This includes 15 media
persistence tests and 42 studio tests, native PostgreSQL owners, controlled
Storage crash/retry, quota/CAS, cutoff, durable AI timeout/reconciliation, and
VNPay invalid/duplicate/late/unknown handling. Provider transports in these tests
are controlled; this is not new live Storage/Gemini/VNPay evidence.

The first invocation failed because the disposable database was stopped
(`ECONNREFUSED`); starting it with `npm run demo:db:start` and rerunning the same
suite resolved that setup failure. No shared database was used for test-suite
database creation or teardown.

The later local full-suite wrapper initially set only TEST_MIGRATION_DATABASE_URL;
14 legacy tests also needed DATABASE_URL and encountered connection/query timeouts
against the inherited configuration. Result: 1573 passed, 14 failed, zero skipped.
Preserved that failed report and corrected the private wrapper to bind DATABASE_URL,
MIGRATION_DATABASE_URL and the migration-admin URL to loopback PostgreSQL only.
Created/migrated isolated local `rv_chain_verification_20261011`; reran the five
affected files unchanged: **18 passed, zero failed/skipped**. No application logic,
test timeout or acceptance threshold was weakened to address this harness error.

Authoritative CI for the deployed fix commit:
[run 38122240243](https://github.com/WDP301-wedding/wedding-be/actions/runs/38122240243).
Both jobs succeeded before upload: formatting, lint, typecheck, unit/contract tests,
OpenAPI, build and dependency audit; empty PostgreSQL migrations, **355 integration
tests in 66 files**, then **1587 full-suite tests in 199 files**. Coverage: statements
96.50%, branches 93.52%, functions 98.36%, lines 97.28%. Local typecheck/lint/build/API
checks and focused Storage tests also passed. Applied migrations were unchanged.

## Evidence classification

| Task  | Implemented/offline                                                               | Configuration                                     | Live acceptance at this checkpoint                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RV-13 | Full contract/deposit runtime; controlled payment suites pass                     | Sandbox enabled                                   | Passed genuine checkout/IPN, signed QueryDr, once-only full-contract ledger and same-identity FULL promotion                                                                       |
| RV-08 | Media/journal/decoder/quota/cutoff suites pass; real SDK duplicate handling fixed | Private Storage configured; RV-07 baseline exists | Passed HTTPS round-trip, retained history, private denial and real Storage recovery after injected acceptance failure                                                              |
| RV-09 | Public read/publication/privacy suites pass                                       | Stable routed `PUBLIC_INVITATION_ORIGIN` set      | Passed HTML/JSON/assets, decoded QR/scan, immutable publication and concealed 404 after unpublish                                                                                  |
| RV-10 | JPEG normalization and durable generation deployed                                | Gemini/model/key present                          | Passed exactly one bounded Google generation, private Storage/full decode and usable canonical design revision                                                                     |
| RV-11 | Durable intent/reconciliation suites pass                                         | Same Invitation runtime                           | Passed real-service/synthetic-provider timeout, real Storage acceptance recovery, canonical Manager reconciliation/audit and abandoned retry refusal; zero additional Google calls |

Configuration, offline/CI tests and live acceptance above are separate evidence.
RV-08 quota/cutoff/CAS boundaries and RV-13 invalid amount/signature/correlation,
unknown and late-callback cases remain controlled test evidence, not deliberately
destructive/paid live scenarios. Public reads are explicit retained derived assets;
they do not expose the private original library or give guest check-in authority.

The only application change is the Storage error-code precedence fix and three
regression cases. No schema, applied migration, OpenAPI or frontend file changed.
Historical SPEC-01–05 and original VNPay/Gemini evidence are preserved. Production
money, frontend/native acceptance, automatic workers and whole-release readiness
remain separate gates. The one new Gemini authorization is consumed.

Cleanup completed: revoked this continuation's temporary Railway SSH key, removed
its two owned local key files, revoked the two current known task sessions and the
two fresh sessions used to revoke them. This does not claim revocation of every
historical session on the synthetic accounts. Public test publication is unpublished.
Retained approved documents, successful/failed receipts, ledger/access evidence
and immutable media/design histories. Final read-only assertions confirmed exactly
one old 15,000,000 VND sandbox payment and one revised 2,433,001 VND payment, with
both bookings still CONFIRMED; no refund, rewrite or reset was performed.

Self-review of the fix covered correctness, provider error boundaries, authorization,
readability and performance: semantic SDK duplicate codes now reach the existing
metadata-verification path; permanent non-conflict failures remain failures; no
overwrite, credential logging, extra query loop or authorization change was added.
Changed-file formatting and `git diff --check` passed. Evidence documents and the
backlog form a separate documentation commit from the reviewed application fix.
