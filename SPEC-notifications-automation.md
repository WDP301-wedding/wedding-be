# Specification: Notifications and Automation

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `notifications-automation` (`SPEC-09`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: Unassigned (next allocation round)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: OPS-001 and OPS-002
- Depends on: `identity-access`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-rsvp`
- Consumers: operational views only

## 1. Purpose and ownership

This module consumes durable integration facts and owns notification preferences,
schedule evaluation, notification intents, delivery attempts, retries, dead-letter
records, and operational delivery status. It never becomes the source of booking,
payment, print, RSVP, or attendance truth and it never publishes delivery status as a
domain fact that another module may use as authorization or settlement proof.

## 2. Delivery and privacy contract

One intent has a stable `notificationIntentId`, source `eventId`, purpose, recipient,
channel, template version, scheduled time, and state. Attempts record provider outcome
without overwriting prior evidence. The deduplication key is
`(eventId, channel, recipientId, templateVersion)`; retry reuses the same intent.

A provider timeout is an unknown outcome that must be reconciled, not a signal to create
another intent. Message inputs contain only references and purpose-specific minimal data:
never raw credentials in ordinary event/render payloads, private media attachments, full guest lists, payment secrets,
phones beyond a channel's delivery requirement, or complete operational notes.

## 3. Consumed events and output boundary

| Producer          | Required event inputs                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| identity-access   | `identity.consultation-access-promoted`                                           |
| booking-lifecycle | timeline review/approval/supersession, deposit eligible, cancellation, completion |
| payments-billing  | payment succeeded, receivable accepted, refund recorded                           |
| invitation-studio | publication change, print quotation/approval/ready                                |
| guest-rsvp        | RSVP and expected-attendance change                                               |

The exact handler names, recipient derivation, template version, and schedule cadence
remain local decisions but each handler must be explicit, versioned, and tested against
the frozen event schema. Consumer processing is idempotent by `eventId`, compares
event version/aggregate sequence where supplied, and safely discards or reconciles
delayed old facts.

## 4. Authorization, channels, and HTTP

Only authorized Manager/Couple settings surfaces may change preferences for their own
scope. No public, guest-link, or Staff route can enumerate notification recipients or
delivery records. Management operations may inspect redacted operational status and
requeue a dead-letter intent only with audit evidence.

Email delivery uses the platform provider boundary. Android push is limited to a
registered, authorized device token managed under identity/device policy. Specified routes
cover scoped preferences and authorized delivery-status reads; workers and provider
webhooks remain internal. Every mutation uses idempotency and the platform error
envelope.

## 5. Acceptance

Prove each required OPS-001 trigger renders minimal content, does not leak protected
data, deduplicates duplicate events, preserves intent under retry/timeout, handles
out-of-order facts, honors revocation/preferences, and makes operational failures
observable without message content. Final acceptance uses real producer outbox events
and one configured email/push test path without treating delivery as a business outcome.

## 6. Trigger, recipient, channel, and scheduling contract

| Trigger / source                                                   | Recipient                                                                        | Channel / exact schedule                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Workspace invitation/password reset via `IdentityNotificationPort` | Intended account email from identity                                             | Transactional email at issuance; privileged credential path below.                                         |
| booking.timeline-review-requested                                  | Other approving party; current consultation Couple account or Manager recipients | Email; Android push only for FULL registered account.                                                      |
| booking.timeline-approved/superseded/deposit-eligible              | Owning Couple + designated Manager operational recipients                        | Email and enabled Android push; dedup by source event/channel/template.                                    |
| billing.payment-succeeded/refund-recorded                          | Owning Couple + Manager finance recipient                                        | Transactional email; payment settlement only, no raw provider payload.                                     |
| invitation.print-quotation-issued/approved/ready                   | Owning Couple; Manager print recipient when action needs handling                | Email + enabled push with exact order/revision references.                                                 |
| Personalized invitation via guest delivery port                    | Explicit household email, never inferred from phone                              | Transactional email; approved public content and scoped link only.                                         |
| Media cutoff due read                                              | Owning Couple                                                                    | One reminder 24 hours before cutoff for policyRevision.                                                    |
| RSVP deadline due read                                             | Owning Couple                                                                    | One reminder 24 hours before deadline for deadlineRevision.                                                |
| D-3 due booking read                                               | Owning Couple + operational Manager recipient                                    | Event start − 72 hours using snapshotted local shift/time.                                                 |
| Completion due booking read                                        | No external recipient needed for command                                         | Worker calls booking-owned completeDue at event end + 12 hours; consumes resulting event for notification. |

Manager recipients come from an explicitly configured approved operational recipient
registry resolved through identity. No hard-coded developer email. Active account/
delivery preference is revalidated before send; a revoked/archived account does not get
ordinary messages. Transactional credential/security/payment messages cannot be muted;
reminders and informational push/email may be disabled by scoped preference.

Worker runs every 60 seconds, claims at most 100 due intents with a two-minute lease,
and reclaims only with persisted provider outcome/reconciliation rules. Scheduled intent
key is `(bookingId, purpose, scheduleRevision, dueAt, channel, recipientId, templateVersion)`.
Each accepted due read is bounded/cursor-paged; handlers recheck current booking/deadline/
cutoff revision just before dispatch. Cancelled events suppress reminders and completion
commands. Missed D-3/deadline/cutoff reminders more than 24 hours late are marked
`SKIPPED_STALE`; future due reminders remain queued.

## 7. Credential delivery and private recipient boundaries

`IdentityNotificationPort` is explicitly consumed for workspace/password credentials,
and `PersonalizedInvitationDeliveryPort` is guest-owned for scoped invitation delivery.
The initial identity synchronous adapter may remain in place until this adapter passes
the same conformance suite; security-sensitive delivery is not inferred from
`identity.consultation-access-promoted`, which occurs after deposit.

Only these purpose-specific outbound commands may contain a transient link credential
at the final delivery boundary. If queued, credential content is encrypted using a
backend-only authenticated-encryption adapter, booking/purpose/intent AAD, versioned key,
and expiry no later than token expiry (maximum 72 hours). Never serialize plaintext into
outbox event, notification render data, log, API response history, audit, analytics,
or dead-letter display. Terminal ciphertext expires/is purged; record metadata remains.
Unknown send result keeps the same intent, ciphertext, and provider idempotency key.

`NotificationRecipientReader` resolves purpose-scoped active email by account ID.
Device tokens are owned here, private, and bound to current active account/session;
register/revoke never accepts another accountId as authority. Default limit five active
Android installations/account; new registration revokes any superseded token for the
same installation ID. On logout/account revocation, push dispatch rechecks identity and
session validity; invalid provider tokens are disabled.

## 8. Intent state, retry, and provider contract

Intent states are `QUEUED, IN_FLIGHT, DELIVERED, RETRYABLE_FAILED, UNKNOWN,
DEAD_LETTER, SKIPPED_STALE, CANCELLED`. Delivery evidence is append-only.
A stable provider idempotency key derives from intent UUID, channel, and template version.
Retry delays are one minute, five minutes, 30 minutes, two hours, then 12 hours;
maximum five retry attempts after the first. Permanent invalid destination/content
errors dead-letter immediately. Unknown result is reconciled using provider message ID/
idempotency status; if provider cannot query it, retain UNKNOWN for Manager resolution
rather than sending blindly after the provider's dedup retention expires.

One backend replica initially hosts the worker. Persisted claim/dedup still handles crash
and duplicate invocation. Worker lease expiry does not itself prove a send failed.
Requeue retains original intent identity; generating a second notification intent for the
same source/channel/recipient/template is prohibited.

## 9. HTTP and independent implementation

| Method/path                                      | Request                                                     | Result / authority                                                           |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET/PATCH /notifications/preferences             | Optional reminder email/push settings with expectedRevision | Own authenticated scope; no accountId role override.                         |
| POST /notifications/android-installations        | installationId, pushToken                                   | Private account/session-bound registration.                                  |
| DELETE /notifications/android-installations/{id} | expectedRevision                                            | Own token revocation.                                                        |
| GET /management/notifications                    | Purpose/state/cursor                                        | Manager redacted status only; no recipient address/token/ciphertext/content. |
| POST /management/notifications/{id}/requeue      | expectedRevision, reason                                    | Same intent retry after eligible outcome; never new money/booking effect.    |

Internal scheduler consumes `BookingAutomationPort`, `InvitationAutomationReader`,
and `GuestAutomationReader`. It owns no domain update except through those ports.
Push adapter errors are classified as retryable/permanent/unknown with no provider body
leakage. Core email/push doubles isolate tests from paid/network providers.

| Slice                                             | Can run alongside                      | Real dependency                                                             |
| ------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Intent/retry/channel adapter and scheduler engine | Seating/Staff/Analytics implementation | Frozen envelope/due/credential DTOs; core outbox lane.                      |
| Individual producer handler                       | Unrelated producer/module work         | That producer's event schema and recipient port, then real outbox evidence. |
| Credential/delivery adapter                       | Guest personalized-link implementation | Identity/guest actual token/revoke/expiry behavior before acceptance.       |
| Completion/deadline automation                    | Client screens and analytics           | Real due-list/complete command ports; time-controlled integration tests.    |

Proposed waves: durable intents/channel registry; credential/recipient/device adapters;
event handlers; due scheduler/reconciliation; settings/inbox/operations API/client; acceptance.

| Requirements/scope | Proof                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| OPS-001            | Every table trigger has producer, recipient, schedule, real-provider fixture and redacted rendered content.     |
| OPS-002            | No plaintext credential/PII/media in ordinary events/logs/status; encrypted privileged credential path expires. |
| Automation         | Fake-clock deadline revision change, cancellation, restart, stale reminder, due completion replay.              |
| Delivery           | Duplicate outbox fact, concurrent claims, unknown timeout, dead-letter/requeue without second intent.           |

## 10. Approved notification-center addition (2026-10-08)

The project owner assigns the entire user-facing notification center to SPEC-09,
including the scoped inbox, unread/read state, and authorized links to relevant screens.
No notification-center slice is scheduled immediately after SPEC-03. Existing identity
credential email delivery retains its accepted implementation and provider boundary.

Inbox/read state is distinct from provider delivery attempts and from business state.
Reading a notification does not approve, pay, or authorize any domain action. The bounded
SPEC-09 plan must define inbox DTOs/routes, recipient and booking scope, content privacy,
retention, deduplication/read semantics, and Web/App acceptance, then integrate real
producer events and settings/email/push/reminders. This scope approval does not mark
the new contracts or implementation ready. See [plan Section 21](./tasks/plan.md#21-approved-product-completion-sequence-2026-10-08).
