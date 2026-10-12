# ADR-011: Retain notification intents and reconcile unknown delivery

## Status

Step 12 implementation in progress, 2026-10-12, on
`codex/notifications-step-12`. Uncommitted by the owner's instruction. Automated
checks, deployed provider evidence and RV-16/GM-W5 acceptance remain separate.

## Context

SPEC-09 owns the notification inbox, private recipient settings and automation.
Existing producer outboxes, Guest capabilities and Booking completion authority
must remain intact. The owner authorized testing with one Gmail mailbox and
confirmed that Android has no application/provider and Guest has no token landing
page. Neither client dependency can be inferred from a working backend API.

## Decision

- Persist one intent per source/channel/recipient/template and a separate immutable
  consumer receipt. Read producer outboxes without changing their publication
  markers. Ordinary intent data contains only reviewed IDs, revisions, dates and
  integer VND totals. No guest response or attendance action is introduced.
- Claim each intent immediately before dispatch, at most 100 per worker run,
  using a 120-second PostgreSQL lease. A slow sequential backlog must not consume
  the leases of messages that have not yet been sent. Runs do not overlap; the
  initial deployment remains one backend replica with a 60-second cadence.
- Brevo acknowledgement records `ACCEPTED` evidence and `UNKNOWN` state. Only a
  matching provider delivery event proves `DELIVERED`. Timeouts, malformed replies
  and expired leases never cause blind resend. Known rate limits use the existing
  intent and the five retry delays; known permanent failures dead-letter.
- Manual requeue is Manager-only, audited, revision-checked and idempotent. It
  retains the intent/source and append-only attempt history. It rejects `UNKNOWN`
  and privileged credential intents; their owner must issue a fresh credential.
- Guest delivery requires an explicit email and native FULL Couple/Manager
  authority. Issuance and encrypted retention share the Guest transaction. AES-256
  GCM binds booking, purpose, intent, key version and expiry. Terminal/expired
  ciphertext is purged, with a maximum 72-hour lifetime and no extension of the
  Guest token lifetime. The final sender revalidates the owned Guest capability.
- Preserve Identity's synchronous workspace invitation/OTP adapter. Access
  promotion emits an immutable reference-only fact, not a credential command.
- Couple audiences resolve through current Booking/Identity readers. Manager
  operational recipients opt into their own purpose registry; there is no fixed
  developer email. Mandatory credential/security/payment email cannot be muted.
  Informational email can be muted; inbox read state is independent of delivery
  and never changes an approval, payment, planning or check-in state.
- Retention runs inside the worker in bounded batches. Purge expired/terminal
  credential content and no-longer-needed private Guest destinations. Remove
  inbox presentation rows after 90 days. Keep immutable source, receipt, attempt
  and deduplication metadata so cleanup cannot create a second delivery. Existing
  account/legal-hold and financial retention policies remain with their owners.
- Android registration/revocation binds private tokens to active Android sessions,
  with five active installations per account. Push delivery remains disabled
  until an actual client/provider is available. Guest email carries a fragment
  credential on the existing public invitation URL unless a landing URL is
  configured. The backend exchange/minimal view are testable; automatic frontend
  consumption of the fragment remains pending.
- Use existing structured logs and Prometheus registry. Record run IDs, intent and
  source IDs, channel, attempt and safe outcome/error codes; exclude addresses,
  message content, provider bodies, device tokens and encryption material.

## Consequences and proof

Unknown sends can require manual investigation when the provider cannot recover a
message ID. This intentionally favors avoiding duplicate mail over automatic
resend without evidence. Inbox expiry does not remove delivery history. Encryption
key rotation must retain old versions until outstanding ciphertext is terminal or
expired; deleting an old key is not a retry mechanism.

The implementation and operations contract are described in the
[backend hand-off](../notifications-step12.md). Native database and controlled
provider tests supplement real Railway/Supabase/Brevo evidence; they do not replace
it. The owner requires no commit before testing and discussion are complete.
