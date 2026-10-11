# RV-13 → RV-08 → RV-09 → RV-10 → RV-11 runtime rehearsal

Date: 2026-10-11, Asia/Saigon. Status: in progress; the revised RV-13 checkout
awaits the owner's action-time approval of VNPay's sandbox service terms. No new
provider settlement, wedding media acceptance, publication or Gemini generation
is claimed by this checkpoint.

## Authorization and target

The owner requested these five tasks in this order. Use the previously authorized
developer-only Railway/Supabase environment, not real customer data. The owner
separately approved **one new Gemini generation, maximum USD 0.10, generic floral
prompt without personal data and no repeat on timeout** in this chat. That new
authorization has not been consumed. The earlier authorized Gemini request remains
the separate historical test documented in [the prior report](rv10-gemini-railway-2026-10-11.md).

- Project: `1c56721d-021a-442c-9e01-bb91abe73adb`.
- Service: `0f70d648-8c59-48bd-84f3-29a86d2e2d38`.
- Environment: `08a2899c-b0d6-4200-a505-604965a4b3fc`, named `production`,
  previously designated by the owner as a developer test environment.
- Source: `5d6cb42211bbce54c1493d8c8d193d7c3450e995`, BE-06–10 merged in PR #27.
- Active successful deployment: `6f92c2b5-aca7-4da8-b4b8-27b1ab999a2b`.
- Target: `https://wedding-be-production-e1dc.up.railway.app`.
- Canonical OpenAPI SHA-256:
  `b82ecfbb8995125178d5676347917aeaf232c48a231be9ef929e71a9c564a8df`;
  HTTP 200 and exact bytes match the current repository.

Read-only runtime inspection confirmed Gemini configuration selects
`gemini-3.1-flash-lite-image`, private Storage configuration is present, and
`PUBLIC_INVITATION_ORIGIN` is absent. No provider feature is accepted by those
configuration observations. Temporary operator access and private local scripts
are outside committed source; tokens, provider keys and signed checkout URLs
must remain private.

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
An action-time approval question and the actual terms screenshot were presented
to the owner; the terms have not been accepted and no test OTP submitted.
Read-only database inspection at this checkpoint found **zero provider receipts**
for the new attempt. Do not describe checkout creation or return-page reachability
as payment success.

Required continuation: complete the provider checkout after the terms approval,
verify genuine accepted IPN/status and one settlement/application, compare the
full-contract ledger charge and deposit, confirm the exact slot and same identity's
FULL promotion, then run the authorized sandbox QueryDr and duplicate proof.
If the checkout expires or becomes UNKNOWN, inspect/reconcile the existing intent
before creating a replacement; never seed success or reset the old payment.

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

## Remaining sequential gates

| Task | Implemented/offline | Configuration | Live acceptance at this checkpoint |
| --- | --- | --- | --- |
| RV-13 | Full contract/deposit runtime; controlled payment suites pass | Sandbox enabled | New provider checkout prepared; terms approval and settlement pending |
| RV-08 | Media/journal/decoder/quota/cutoff suites pass | Private Storage configured; RV-07 baseline exists | New confirmed booking prerequisite pending; round-trip and staged crash recovery not executed |
| RV-09 | Public read/publication/privacy suites pass | `PUBLIC_INVITATION_ORIGIN` missing | Origin setup, deployed HTML/JSON/asset, decoded generic QR and concealed unpublication pending |
| RV-10 | JPEG normalization deployed; no new paid call | Gemini/model/key present | One bounded call authorized but unused; persisted asset and usable design acceptance pending |
| RV-11 | Durable intent/reconciliation suites pass | Same Invitation runtime | Staged real-service/Storage fault and Manager recovery rehearsal pending RV-10 |

Prepared private checkpointed harnesses for the remaining steps. Their existence
is not execution evidence. The planned Gemini harness runs the compiled real
Invitation router and owner composition inside the named Railway container with
an injected one-call Google client adding `maxOutputTokens=3000`, minimal thinking,
10-second timeout and SDK attempts=1. Its conservative token upper bound must be
checked by `countTokens` before dispatch against [Google's current pricing](https://ai.google.dev/gemini-api/docs/pricing).
These are test-specific cost controls; do not claim the normal deployed endpoint
has a persistent monetary budget cap. Use local and remote exclusive dispatch
guards. Recovery fault tests use synthetic output and zero additional Google calls.

No application source, applied migration, OpenAPI or frontend file was changed
for this checkpoint. No task closure or production readiness claim is made.

Cleanup: revoked the task-only Railway SSH key and removed its two owned local
key files. Revoked the two current task login sessions and the two short-lived
sessions used to revoke them. Preserve the pending payment attempt, hold,
approved contract/timeline and all historical ledger evidence for continuation.
Changed-file Prettier verification for this new report and `git diff --check`
passed; the backlog keeps its existing manually formatted task-table convention.
