# SPEC-11 final API and provider hand-off

Date: 2026-10-13, Asia/Saigon. Backend only; synthetic staging/demo.
The owner accepted [RV-21 as a NO_GO hand-off](../tasks/evidence/spec11-rv21-owner-acceptance-2026-10-13.md).
This document completes REL-W4 after that review. REL-W5 records the final decision
and recovery separately. Product/client delivery is not a completed backend test.

## Immutable identity

Reviewed executable source: `d0001d93e52dd392d7b2b5873ebbbf664084958d`.
Provider: `BACKEND-RELEASE@3.0.0`. Contract: `WEDDING-CONTRACT-3@3.0.0`.
API: [OpenAPI JSON](../openapi/openapi.json),
[digest](../openapi/openapi.sha256), SHA-256
`6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
There are 218 routes and 60 ordered unchanged migrations.
The [immutable reviewed manifest](../tasks/evidence/spec11-release-manifest-demo-rebuild-2026-10-13.json)
pins all source, route security, migration/evidence hashes, provider package versions
and configuration modes. The final acceptance record references this artifact;
it does not rewrite its original 68/71-task pre-review snapshot.

Staging API: `https://wedding-be-spec11-spec11-staging.up.railway.app`.
Project/environment/backend/PostgreSQL IDs remain pinned in the staging checkpoint.
The historical runtime/provider source is `e8e7945548ac40d8308a5e4841fc0314c2d40276`.
Later documentation commits are not fresh deployment/provider evidence.

## Schemas, examples, errors, roles and money

The [owner contract and role matrix](backend-release-spec11.md#api-and-frontend-integration-checklist)
links the strict schemas, examples, errors, migrations and hand-offs for every owner.
Notifications use [native notification API documentation](notifications-step12.md)
and the [FCM backend hand-off](android-fcm-backend.md). OpenAPI is the exact route/DTO
authority; undeclared security never implies public authorization.

Manager and owning Couple retain their scoped commercial/operational permissions;
assigned Staff can check in listed Guests only when explicitly enabled. Guest/public
links view a minimal invitation and grant no attendance, list or billing writes.
Groups and planning work without names; NONE attendance is unknown/null. Planning
is explicitly entered and cannot be derived from guest count. Money is integer VND,
server-calculated, with immutable contract/appendix/invoice history and idempotent
ledger effects. Billing never derives charges from named check-in totals.

## Provider and operating modes

| Component          | Reviewed mode and evidence boundary                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL         | 60 migration names/checksums pinned; prior isolated runtime/recovery evidence retained.                                                                                         |
| Brevo/email worker | Exactly two historical authorized deliveries; worker currently off, budget exhausted. No additional dispatch is authorized by hand-off approval.                                |
| VNPay              | Sandbox only; historical signed balance reconciliation and once-only replay retained. Revised exact-candidate provider gate remains pending; real-money acceptance is separate. |
| Supabase Storage   | Private-storage configuration present; owner/target-scoped receipts remain separate from configuration. No new upload proof is claimed here.                                    |
| Gemini             | Configured model `gemini-3.1-flash-lite-image`, SDK `@google/genai@2.24.0`; no paid generation executed in SPEC-11.                                                             |
| Android FCM        | Backend adapter/registry/retry/configuration hand-off complete; sending off. Owner deferred live device/provider acceptance to app integration.                                 |
| Metrics/tracing    | Optional exporters disabled; no collector delivery claimed.                                                                                                                     |
| Recovery           | Synthetic-demo migration + native seed rebuild; recovery owner Lê Bá Bách, no 30-day retention requirement for this selected demo.                                              |

The [recovery operator procedure](spec11-recovery-operator.md#selected-demo-rebuild-procedure)
requires a new isolated database, pinned migrations, a newly fenced seed target and
checkpoint, privacy/auth/money/readiness checks and controlled reopening. Existing
provider receipts and UNKNOWN payment state must not be fabricated during rebuild.

## Separately owned frontend/app integration checklist

The API, provider modes, role/error examples and recovery boundaries above are
supplied by backend. The frontend/app team records its own completion of:

- [ ] Pin client commits and the exact OpenAPI digest; consume strict DTOs/errors.
- [ ] Verify browser cookies, refresh, exact CORS/origins and authorization denials.
- [ ] Support no Guest list, Group seating, explicit planning and NONE/null attendance.
- [ ] Preserve integer VND, server totals, stale revisions and idempotency keys.
- [ ] Use minimal read-only invitation links and consume Guest fragments safely.
- [ ] Configure Firebase/Android sessions and installations, token refresh/revocation,
      notification display/navigation; then perform authorized live push acceptance.
- [ ] Record client/native build and complete product integration evidence separately.

These unchecked client items do not reopen completed backend tasks. They keep full
product release pending. The backend release decision remains **NO_GO** until its
remaining exact-candidate runtime/provider and worker gates pass; owner review of
this hand-off does not convert those observations to PASS.
