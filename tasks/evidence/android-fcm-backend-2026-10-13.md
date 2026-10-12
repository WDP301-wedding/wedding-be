# Android FCM backend extension — 2026-10-13

Owner selected direct FCM and identified Firebase project `wdp301-wedding`
(project number `809672585844`). The owner explicitly reported that the service
account was not configured in Railway. No Firebase credential was supplied,
no FCM network send was executed, and no manual shared Railway deployment or
Supabase migration was performed during this extension. Automatic deployment
state is not reverified by this offline acceptance record.

Source: `a325469714a4fba028b51a667162a9baec5fbc4e` on
`codex/notifications-step-12`; provider foundation commit `aaea036`.
OpenAPI SHA-256: `5656f32255be1ca345dfc381b474db99c4e71b3f28bbc80f6740b598ccc2e1b3`.
Migrations: `20261013010000_notification_fcm_delivery` and
`20261013020000_notification_fcm_retry_after` (additive, not applied to
shared Supabase here). [Configuration and hand-off](../../docs/android-fcm-backend.md).

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

## Unresolved external gates

| Gate | Current evidence |
| --- | --- |
| Railway service-account configuration | Missing, according to the owner; secret values are not requested in chat. |
| Shared target migration/deployment | No manual migration/deployment performed or target state reverified here. Historical SPEC-09 email deployment evidence remains separate. |
| Actual worker -> FCM acceptance | Pending authorized account/device registration, configuration and rehearsal. |
| Android receipt/display/navigation | Separate app-team integration evidence; not inferred from FCM acceptance or backend tests. |
| Production readiness | Not claimed. Human PR review and relevant release gates remain separate. |

Official protocol references are linked in the hand-off. Existing SPEC-09/RV-16/
GM-W5 email evidence is preserved and does not prove this new FCM transport live.
