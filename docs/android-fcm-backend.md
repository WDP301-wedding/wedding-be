# Android push through FCM HTTP v1

Owner selected direct FCM on 2026-10-13. Firebase project: `wdp301-wedding`;
project number: `809672585844`. The owner confirmed that Railway does not yet have
a service account configured. This document describes the additive backend
extension to SPEC-09, not a completed live-provider or Android-client acceptance.

## Prepare Firebase and Railway

1. In Firebase console select **wdp301-wedding**, then **Project settings > Cloud
   Messaging**. Ensure Firebase Cloud Messaging API (HTTP v1) is enabled.
2. In **Project settings > Service accounts**, choose an existing suitable service
   account or create a dedicated notification sender. Grant the sending permission
   through the Firebase Cloud Messaging API Admin role on the target project;
   do not grant Owner merely to send notifications.
3. Generate/download the service-account JSON using the approved key-management
   process. It is a server secret; do not paste it into chat, Git, frontend env
   files, logs, or API requests. The app's `google-services.json` is a different
   configuration file and cannot authorize the backend sender.
4. In the existing Railway backend service set the variables below. Keep sending
   disabled while applying migrations and preparing the explicitly authorized
   test account/device. Preserve the existing email, DB, worker and Guest key
   settings.

| Variable                              | Value / purpose                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTIFICATIONS_FCM_ENABLED`           | Initially `false`; explicitly enable with `true` for the approved rehearsal.                                                                 |
| `NOTIFICATIONS_FCM_SERVICE_ACCOUNT`   | Entire service-account JSON stored as a Railway secret. Its `project_id` must target `wdp301-wedding`; RSA private key is validated locally. |
| `NOTIFICATIONS_FCM_ACCOUNT_ALLOWLIST` | Comma-separated backend account UUIDs of authorized testers; keep the fence during rehearsal. Blank permits all otherwise eligible accounts. |
| `NOTIFICATIONS_BOOKING_ALLOWLIST`     | Existing test booking fence; applies to push as well as email.                                                                               |
| `NOTIFICATIONS_WORKER_ENABLED`        | Existing worker switch, `true` for actual recurring execution; its real-email prerequisite remains unchanged.                                |

The Firebase project number is not a service credential, device token, or backend
installation UUID. Before enabling the worker on this code, apply the additive
`20261013010000_notification_fcm_delivery` and
`20261013020000_notification_fcm_retry_after` migrations using the existing migration
deployment procedure. Do not rewrite applied migrations. Disabling FCM stops new
Android intents and the adapter; old migration/source versions cannot safely run
against intents in the new `PROVIDER_ACCEPTED` state. Operational rollback should
disable FCM while retaining compatible code and all delivery history.

## App/backend hand-off

The Android team configures Firebase for the same project and supplies a native
FCM registration token. An Expo push token and an installation UUID are not FCM
registration tokens. Existing registration requires a current authorized Android
session, `Idempotency-Key` and the current installation revision:

```http
POST /api/v1/notifications/android-installations
Authorization: Bearer <android-session-access-token>
Idempotency-Key: <new-key>
Content-Type: application/json

{
  "installationId": "<stable-client-installation-uuid>",
  "pushToken": "<native-fcm-registration-token>",
  "expectedRevision": 0
}
```

Initial revision is zero; refresh/re-registration uses the returned current
revision. Responses omit the token. Limit: five active installations per account.
Registration/refresh/logout handling, Android notification permissions and
notification display/navigation remain the app team's responsibility.

Notifications contain a generic title/body and string data fields:
`notificationId`, `bookingId`, `purpose`, `owner`, optional `referenceId`. The app
uses `notificationId` for presentation deduplication, then fetches authorized
current data when opening a notification. Never treat a push payload as authority
to approve a contract, settle a payment, or view a booking. No Guest credential,
OTP, contact information, amount, or private content is sent in the push payload.
Android transport uses normal priority and a one-hour TTL.

Management delivery status adds the `PROVIDER_ACCEPTED` enum value. Client API
models/status rendering must consume the updated OpenAPI digest before enabling
FCM for that release; it is not the inbox read state or device delivery status.

## Backend behavior and recovery

When explicitly enabled, producer events and due reminders add the `ANDROID`
channel for informational purposes. Couple recipients require FULL booking
access; Manager recipients require the configured operational registry and
current assignment. Transactional credential/security/payment/refund/final-invoice
email purposes retain email-only outbound delivery. Their existing inbox behavior
is preserved. Informational push honors `reminderPush` independently of email.

The dispatcher freezes up to five current targets once, keeps private device
outcomes in `NotificationPushDelivery`, and rechecks account/session, booking
scope, preferences and installation revision before sending to each target.
Successfully accepted targets are not resent when another target retries. A newly
registered device is not added to a previously frozen batch; future notifications
can target it. A refreshed/revoked target is canceled for that batch.

| Outcome                       | Meaning / action                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVIDER_ACCEPTED`           | FCM returned a message ID for the remaining eligible targets. This is terminal for automatic sending and does **not** prove device receipt/display. |
| `RETRYABLE_FAILED`            | Definitive temporary rejection/auth unavailable before sending; existing bounded retry schedule applies only to failed targets.                     |
| `DEAD_LETTER`                 | Permanent rejection or retry exhaustion. Audited Manager requeue preserves successful targets and retries eligible failed targets.                  |
| `UNKNOWN`                     | Ambiguous network result or crash/lease expiry after a send could have occurred. No automatic retry and no claim of delivery.                       |
| `CANCELLED` / `SKIPPED_STALE` | Revoked/absent authority, preference, stale domain facts or test fence suppresses sending.                                                          |

A typed FCM `UNREGISTERED` rejection disables only the same stored token/revision.
A generic `INVALID_ARGUMENT`/HTTP 400 does not prove token expiry and must not
disable the device. Token refresh racing with a rejection is preserved. FCM HTTP
v1 offers no send idempotency or per-message status lookup used by this adapter;
`UNKNOWN` requires operator investigation rather than blind requeue. Known
provider acceptance is recorded separately from delivery, and no new
device-receipt endpoint is inferred from existing inbox read state.

Valid provider `Retry-After` deadlines (seconds or HTTP date) are persisted per
device. The worker takes the later of that deadline and its bounded retry schedule;
worker recreation and audited requeue cannot bypass the stored deadline. Temporary
rejections wait at least one minute before an automatic retry.

## Acceptance and remaining gates

Offline checks must prove producer/due-job generation, per-device dedup/retry,
unknown/crash recovery, current authority/preferences, token refresh races,
immutable history, private database RLS, strict OpenAPI and migration compatibility.

Live rehearsal on the owner's Railway/Supabase target requires a configured
service account and an authorized Android test registration. Trigger a permitted
native booking event or due reminder; capture the source revision, migration/API
digest, worker/intent/device-attempt evidence and redacted FCM message ID. Firebase
console's test-send alone does not prove backend worker integration.

Keep separate labels for **offline implementation verified**, **FCM acceptance
verified**, and **Android receipt/display/navigation verified**. Backend provider
acceptance may be recorded before client presentation testing, but neither is
automatically production readiness. No live FCM claim is made while credentials
and the authorized test registration are absent.

Official references:
[FCM HTTP v1 authentication and sending](https://firebase.google.com/docs/cloud-messaging/send/v1-api),
[FCM error handling](https://firebase.google.com/docs/cloud-messaging/error-codes),
[Android Firebase setup](https://firebase.google.com/docs/cloud-messaging/android/get-started).
