# Step 12 Notifications backend hand-off

Status: backend developer acceptance complete, 2026-10-12, for NTF-W1–W5,
RV-16 and GM-W5 on `codex/notifications-step-12`. Executable source: `a424777`;
[CI/runtime/provider evidence](../tasks/evidence/notifications-rv16-gmw5-2026-10-12.md)
and [immutable source/API manifest](../tasks/evidence/notifications-provider-manifest-2026-10-12.json).
Do not recreate the owner-deleted `tasks/plan.md`.

## Runtime and owner boundaries

`notifications-automation` owns durable intents, receipts, private destination
overrides, encrypted Guest delivery material, attempts, preferences, installations,
inbox presentation/read state, schedule scans and frozen completion commands.
Identity and Booking readers supply current audience/session facts. Producer
outboxes are read-only; each consumer retains its own receipt. Booking's native
automation port remains the only completion writer. Guest's native command
transaction issues/revalidates personalized credentials. Delivery/read state is
never financial settlement, approval, attendance or planning authority.

Existing synchronous Identity credential email remains in use. Android APIs are
implemented; the owner-selected [FCM backend extension](android-fcm-backend.md)
adds provider delivery behind explicit configuration. Live FCM acceptance and
Android device receipt remain pending their own evidence. No Guest
response routes, statuses, deadlines or jobs are added. Generic sharing, planning,
seating, print and billing need no named Guest list or email destination.

## Private API inventory

All paths below are relative to `/api/v1`. Authentication uses the existing bearer
session. Responses use `{ "data": ... }`, no-store and no-referrer. Mutation
headers require the existing `Idempotency-Key` policy. Bodies are strict, revisions
are server-authoritative and errors use the platform envelope.

| Method/path                                            | Authority and result                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET/PATCH `/notifications/preferences`                 | Own Manager/Couple scope; reminder email/push, revision.                                                                  |
| GET/POST `/notifications/android-installations`        | Own metadata; registration requires active Android session, installation UUID, private token and expected revision.       |
| DELETE `/notifications/android-installations/{id}`     | Own installation; disables and clears token with expected revision.                                                       |
| GET/PATCH `/management/notifications/recipient`        | Current Manager configures own operational purposes and optional explicit email override; response omits address.         |
| GET `/management/notifications`                        | Manager redacted status, purpose/state filters, cursor and limit 1–50.                                                    |
| POST `/management/notifications/{id}/requeue`          | Manager; eligible DEAD_LETTER, expected revision, reason; original intent retained.                                       |
| GET `/notifications/inbox`                             | Own current Booking scope; bounded items and resource references.                                                         |
| GET `/notifications/unread-count`                      | Own current scope; unread presentation count.                                                                             |
| POST `/notifications/inbox/{id}/read`                  | Own item with expected revision; read state only.                                                                         |
| POST `/notifications/inbox/read-all`                   | Own items created through a supplied non-future timestamp; later arrivals stay unread.                                    |
| POST `/bookings/{bookingId}/guests/{guestId}/delivery` | Guest-owned Manager/FULL Couple authority; explicit intendedEmail, expected credential revision; identifiers/expiry only. |

Staff-only, public and Guest capabilities cannot enumerate settings, destinations,
inbox or operational delivery records. Inbox resources contain owner, booking ID
and minimal references; frontend routing belongs to the frontend team.

Example preference mutation:

```json
{ "expectedRevision": 0, "reminderEmail": false }
```

Example Guest delivery mutation:

```json
{ "expectedRevision": 0, "intendedEmail": "authorized-recipient@example.invalid" }
```

The example destination is illustrative and cannot receive mail. Live verification
uses only the owner's authorized mailbox. Credential expiry, revocation and the
minimal invitation session/view remain Guest-owned. The email URL places the raw
credential in a fragment, not query parameters. No frontend token landing page
exists yet; API delivery/exchange evidence cannot accept that missing client flow.

Relevant errors include `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`,
`IDEMPOTENCY_KEY_REUSED`, `NOTIFICATION_REVISION_STALE`, `ANDROID_TOKEN_IN_USE`,
`ANDROID_INSTALLATION_LIMIT`, `NOTIFICATION_REQUEUE_NOT_ELIGIBLE`,
`NOTIFICATION_CREDENTIAL_REISSUE_REQUIRED` and `GUEST_DELIVERY_UNAVAILABLE`.
Check generated OpenAPI for the exact current schemas and error envelope.

## Configuration and operation

`NOTIFICATIONS_WORKER_ENABLED` defaults to false. Enabling requires the platform
email provider. Optional `NOTIFICATIONS_EMAIL_ALLOWLIST` and
`NOTIFICATIONS_BOOKING_ALLOWLIST` fence developer rehearsals. Configure the
versioned 32-byte canonical-base64 key map in `NOTIFICATIONS_CREDENTIAL_KEYS` and
its `NOTIFICATIONS_ACTIVE_KEY_VERSION` before accepting Guest queued delivery.
Keys belong only in backend secret configuration. Never copy secrets to evidence,
OpenAPI, chat, logs or client configuration.

`NOTIFICATIONS_GUEST_LINK_URL` is optional: HTTPS, without credentials/query/hash;
loopback HTTP is accepted only in test/development. Without it the existing public
invitation URL supplies the target. A configured URL still needs actual frontend
implementation and its separate verification.

The worker starts after HTTP startup and uses its own owner composition/pool.
Every 60 seconds it reconciles expired leases and unknown provider evidence,
consumes at most 100 supported outbox facts, pages due readers, and claims/sends
at most 100 intents individually. Graceful shutdown stops new claims and drains
the active operation. Reminder schedules bind effective timeline/policy revisions:
D-3 is event start minus 72 hours; media cutoff is minus 24 hours. Reminders over
24 hours late become stale. Completion is native event end plus 12 hours with a
persisted command identity/time/revision so restart cannot change replay inputs.

`ACCEPTED` means Brevo accepted the request; intent stays `UNKNOWN` until an actual
matching delivery/rejection report is available. Retry delays are 1 minute,
5 minutes, 30 minutes, 2 hours and 12 hours after the first attempt. Ambiguous
failures and expired leases remain UNKNOWN. Do not requeue or generate a new intent
to bypass uncertainty. Manager can requeue an eligible non-credential dead letter
after fixing its cause, with audit reason; approval/payment authorities are untouched.

Retention is automatic and bounded per worker run: expire credential ciphertext,
clear eligible private destinations, and remove inbox rows older than 90 days.
Keep deduplication, attempt and source metadata. It does not rewrite contracts,
invoices, financial evidence or another owner's retention rules. Existing identity
and consultation retention CLIs keep their documented operator/fingerprint gates.

## Observability and investigation

Use existing Railway JSON logs and the authenticated metrics endpoint. Worker runs
carry correlation ID, module and entry point. Attempt records/logs contain intent
and source event IDs, attempt, channel, outcome and safe error code only. Metrics:

- `wedding_notification_worker_runs_total`
- `wedding_notification_worker_duration_seconds`
- `wedding_notification_queue`
- `wedding_notification_delivery_attempts_total`
- `wedding_notification_delivery_duration_seconds`

Metric labels are bounded state/channel/outcome enums, never booking/recipient IDs.
Investigate worker failure, growing UNKNOWN/dead-letter queues and runs exceeding
the 60-second cadence. There is no new public worker/webhook trigger. Existing
Railway restart/health and metrics authentication remain in force.

## Migration and acceptance evidence

Five additive Notifications migrations follow the existing 47-migration main baseline.
A sixth forward migration extends Seating invalidation reasons for explicit planning
headcount changes, including in-range changes. A new printable requires a fresh
confirmation for that count; an existing PDF remains immutable. They add
private RLS-protected tables, immutable intent/source/receipt/attempt guards,
encrypted payload TTL/purge guards, recipient/account uniqueness, durable scans and
command/inbox/device guards. Applied historical migrations remain unchanged.
Run fresh deployment plus populated baseline upgrade on disposable PostgreSQL,
then verify exact shared Supabase migration checksums after an authorized rollout.

Required checks are typecheck, lint, tests/coverage, build, contract tests,
OpenAPI generation/check and relevant migration/security rehearsals. Native
integration tests cover real owners, transaction rollback, concurrent dedup/claim,
retry budget, UNKNOWN/no-resend, stale revisions, private HTTP/auth, Guest minimal
view and retention. Slow-backlog and UUID-case regressions are explicit tests.

Linux CI passes 1,780 tests with the unchanged per-file coverage gate. Railway
compiled modules, OpenAPI and all 53 applied migration checksums match the accepted
source. Hosted recurring-worker/restart, actual Brevo delivery and native GM-W5
journeys are recorded in the linked evidence; configuration and health remain
separate facts. Android push and frontend fragment consumption remain downstream
limits. RV-21/release review and human PR approval remain separate.
