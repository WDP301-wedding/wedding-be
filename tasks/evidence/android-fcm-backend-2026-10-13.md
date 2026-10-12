# Android FCM backend extension — 2026-10-13

Owner selected direct FCM and identified Firebase project `wdp301-wedding`
(project number `809672585844`). The owner explicitly reported that the service
account was not configured in Railway during initial offline acceptance. No Firebase
credential was supplied, no FCM network send was executed, and no manual shared
Railway deployment or Supabase migration was performed during that offline phase. Automatic deployment
state was not reverified by that initial offline acceptance. The subsequent
owner-authorized runtime checkpoint below records the deployed state separately.

Source: `a325469714a4fba028b51a667162a9baec5fbc4e` on
`codex/notifications-step-12`; provider foundation commit `aaea036`.
OpenAPI SHA-256: `5656f32255be1ca345dfc381b474db99c4e71b3f28bbc80f6740b598ccc2e1b3`.
Migrations: `20261013010000_notification_fcm_delivery` and
`20261013020000_notification_fcm_retry_after` (additive; offline checks preceded
the authorized shared deployment below). [Configuration and hand-off](../../docs/android-fcm-backend.md).

## Implemented behavior

- Direct FCM HTTP v1 with Google Auth Library, validated server-only service
  account JSON, disabled-by-default configuration and optional test account fence.
- Native event/due-job Android intents for informational purposes; FULL Couple
  access or assigned operational Manager, current Android session and push preference.
- Private, RLS-protected per-device attempts and immutable target snapshots;
  successful devices are not resent during partial retry or audited requeue.
- Typed unregistered-token handling with revision checks that preserve concurrent
  token refresh; definitive temporary errors retry, ambiguous sends do not.
- Durable `Retry-After` fences survive worker recreation and audited requeue;
  seconds and HTTP-date forms are parsed without synchronous provider retries.
- `PROVIDER_ACCEPTED` status and updated OpenAPI distinguish provider acceptance
  from device delivery, inbox reading, and domain/financial effects.
- Existing email credentials, Guest delivery and financial history are preserved.

## Offline verification

Windows/Node 24.15 local checks: formatting, lint and typecheck pass on the final
source. Final-source Linux quality CI passes production build, OpenAPI freshness,
unit/contract suites and dependency-audit policy. The audit retains one existing,
documented, unexpired exception (`1145093`); its policy was not weakened.

- Configuration/provider/logging/OpenAPI focused run: 4 files, **26 tests pass**.
- Full unit suite: 146 files, **1285 tests pass**; contract suite: 16 files,
  **43 tests pass** locally after updating the disabled FCM configuration snapshot.
- FCM device dispatch, populated upgrade and runtime composition focused run:
  3 files, **11 tests pass** against disposable local PostgreSQL databases.
- Final Retry-After provider run: **15 tests pass**, including seconds, HTTP date,
  minimum delay, invalid and overflowing header inputs. Final disposable
  PostgreSQL dispatch/upgrade run: **9 tests pass**, including persisted backoff
  across worker recreation and audited requeue.
- Separate successful focused coverage runs retain the existing 80% per-file
  line/branch bar: FCM config 100% lines / 93.75% branches, FCM adapter 100% / 100%,
  device dispatcher 98.11% / 94.11% on the final Retry-After source.
- Mutation check: reversing the typed `UNREGISTERED` condition fails two provider
  tests; the correct condition was restored before committing and final verification.

Some wider Windows coverage runs had native Vitest worker exits
(`3221226505`) in runtime/Guest/upgrade files. Those runs are **not** passing
evidence. Relevant files pass in isolated runs; full Linux CI is the offline
acceptance authority and no existing checks are removed or weakened.

Exact-source Linux CI:
[Backend CI 38291299216](https://github.com/WDP301-wedding/wedding-be/actions/runs/38291299216).
Status: **success** on executable source `a325469` (both jobs completed).
The quality job passes 146 unit files / **1290 tests** and 16 contract files /
**43 tests**, formatting/lint/typecheck, generated OpenAPI, production build and
dependency audit. The PostgreSQL job applies all migrations to an empty database,
passes 91 integration files / **477 tests**, then passes the full suite in
253 files / **1810 tests** with the unchanged 80% lines/branches per-file bar.
Aggregate coverage is 97.43% lines / 93.20% branches. Documentation/checklist-only
follow-up commits do not change this tested executable source.

Preceding FCM source `15d214cf2dfc1964e7d2d693f2b6524b7548030a` passed
[Backend CI 38289648013](https://github.com/WDP301-wedding/wedding-be/actions/runs/38289648013):
146 unit files / 1285 tests, 16 contract files / 43 tests, 91 integration files /
476 tests and full coverage 253 files / 1804 tests. Final acceptance above includes
the additional Retry-After implementation and regression coverage.

## Authorized runtime checkpoint

On 2026-10-13 (Asia/Saigon), the owner authorized deployment to the existing
Railway backend and connected Supabase developer test environment and confirmed
that no Android test device or FCM registration token exists. The environment is
named `production` in Railway; this record is developer test evidence, not a
production readiness claim.

- Uploaded clean branch source `a838a057945bba0eea3156273f51d1b95e70d7b0`, whose
  executable source is the CI-accepted `a325469` above. Exact HEAD
  [CI 38292345101](https://github.com/WDP301-wedding/wedding-be/actions/runs/38292345101)
  also passed before deployment.
- Railway deployment `2cb3ee74-005f-4ce4-8705-f61be90c5efe`: **SUCCESS**.
  Only the backend's two FCM variables were applied. The service-account JSON
  matches the locally validated owner-downloaded credential, targets
  `wdp301-wedding` and has a valid RSA private key. Braces are required JSON object
  syntax. Secret contents and OAuth tokens are absent from committed evidence.
- An unrelated staged service deletion was left untouched; the whole project
  staged patch was not committed. FCM stayed `false`; existing worker/email/DB
  settings were preserved.
- Actual container verification at `2026-10-12T19:35:30.074Z` matched all **461**
  compiled JavaScript modules (314 application + 147 generated Prisma), the
  OpenAPI digest and all **55** completed migration SQL checksums in Supabase.
  Both new FCM migrations are applied; unfinished migrations: zero. Push history
  RLS is enabled. Registered Android installations: zero.
- Deployed-container Firebase preflight at `2026-10-12T19:39:25.630Z`: messaging
  OAuth succeeded; read-only IAM permission check returned HTTP **200** and
  confirmed `cloudmessaging.messages.create`. The FCM request used
  `validate_only: true` and a synthetic invalid token, returned HTTP **400** / typed
  `INVALID_ARGUMENT` as expected, and delivered no notification. This checks
  authentication/connectivity/permission, not worker message acceptance.
- Public `/health/live` and `/health/ready`: **200**; `/api/v1/openapi.json`:
  **200**, exact accepted SHA-256. Unauthenticated Android installation POST:
  **401**. Six automatic worker cycles from `19:34:41Z` through `19:39:42Z`
  completed with zero consumed/claimed intents and no worker failure in the
  inspected deployment log window. Idle worker ticks do not prove FCM dispatch.
- Temporary diagnostic SSH access was removed and its local private/public key
  deleted. No test account, device, intent, email send or payment was created.

Sanitized machine-readable receipts:
[runtime/deployment/Firebase/worker verification](android-fcm-runtime-2026-10-13.json).
Protocol references: [FCM validate-only request and required IAM permission](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send),
[read-only permission test](https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/testIamPermissions).
FCM stays disabled until an authorized Android session registers a native token,
then a fenced native event/due-job rehearsal captures durable device attempts and
FCM message ID. Client receipt/display/navigation remains separately owned.

## Unresolved external gates

| Gate | Current evidence |
| --- | --- |
| Railway service-account configuration | Verified in the deployed container; OAuth and sending permission pass. FCM remains disabled. |
| Shared target migration/deployment | Exact deployed compiled modules/OpenAPI and all 55 applied migration checksums verified above. Historical SPEC-09 email deployment evidence remains separate. |
| Actual worker -> FCM acceptance | Pending authorized native Android account/device registration and fenced rehearsal; no token is currently available. |
| Android receipt/display/navigation | Separate app-team integration evidence; not inferred from FCM acceptance or backend tests. |
| Production readiness | Not claimed. Human PR review and relevant release gates remain separate. |

Official protocol references are linked in the hand-off. Existing SPEC-09/RV-16/
GM-W5 email evidence is preserved and does not prove this new FCM transport live.
