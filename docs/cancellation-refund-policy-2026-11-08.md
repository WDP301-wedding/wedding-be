# Cancellation and deposit refund — owner amendment 2026-11-08

Scope: backend, Manager web, Couple web and PRM-app. Keep approved contract/PDF,
appendix, invoice and financial history unchanged. No provider refund or compensation
transfer is introduced.

- Show a verified deposit as already received, not ineligible.
- Couple can request cancellation before deposit with RESTRICTED booking access.
  The assigned Manager still approves/rejects; a request never cancels immediately.
- Freeze cancellation origin, exact accepted request time, agreed event start,
  approved contract version and received deposit when cancellation is accepted.
  Couple personal cancellation: at least 30 × 24h => 100%; at least 7 × 24h => 50%;
  below 7 × 24h => 0%. Use the selected request's received time, not decision time.
- Restaurant cancellation: 100% of received deposit on system, including force
  majeure. Any additional compensation is handled externally; do not change the
  existing contract or create a negative payment/ledger amount for it.
- Server calculates integer VND, rounding a half dong down. Subtract previous refunds
  and preserve source-payment, entitlement, revision, authorization and idempotency guards.
- Preview actual source payments and 0/50/100% amounts before cancellation; these
  options remain disabled. After cancellation only the applicable option can be used.
- Missing origin/request evidence or unrecognized legacy contract needs review;
  never silently assign the current standard contract to old bookings.
- Existing retained approvals/history are preserved. No backfill of old cancellations.

## API and deployment hand-off

Apply the new forward migration before deploying this backend. Existing cancellations
are left with no policy snapshot; never backfill their origin from the actor role.
The schema adds only optional fields to existing responses and Manager cancellation.

Manager cancellation remains authenticated, role-restricted, revision-checked and
idempotent. New clients send an explicit origin:

```json
{ "expectedRevision": 8, "initiator": "RESTAURANT", "reason": "Nhà hàng không thể phục vụ" }
```

The Couple request endpoint retains its strict original body; only owned booking
access is relaxed to RESTRICTED. Manager approving that request always freezes COUPLE
origin and that request's server timestamp. Direct Manager COUPLE cancellation uses
an existing pending request if present, otherwise the time it is recorded.
Omitting origin on the compatible Manager endpoint cancels with review required.

GET /management/bookings/{bookingId}/billing-recording adds deposit.isSettled,
settledAmountVnd and settledAt. cancellationRefund returns the frozen origin,
request and shift timestamps, deposit payment/contract references, percent,
entitlement, prior refunds, remaining amount, canRecord and all three options.
Before cancellation, canRecord is false and every source has maxRefundVnd zero.
No request timestamp is fabricated for preview. Only the actual deposit source is
refundable after cancellation; a balance payment is never re-labelled as a deposit.

Existing refund commands remain server-authoritative and idempotent.
BILLING_REFUND_LIMIT_EXCEEDED (409) covers unknown policy, wrong deposit source or
amount beyond the remaining entitlement. Original source/decision capacity, stale
revision, ownership and role checks still apply. A database trigger independently
retains the accepted policy and rejects ledger refunds above its frozen entitlement.
The response is advisory; clients must reload after writes or revision conflicts.

## Verification

Evidence: local logs .refund-* and output/playwright/refund-policy (ignored artifacts).
No production/shared database writes, provider transfers, contract rewrites or APK
builds are part of this verification. Deployment status is separate from offline
and disposable PostgreSQL evidence.

- Backend: 1,604 unit tests passed; typecheck, production build, generated OpenAPI
  check and scoped ESLint passed. All 83 migrations applied to an empty disposable
  PostgreSQL database. Six actual HTTP refund-policy scenarios passed using
  --pool=threads (Windows fork workers exited natively when run together; the
  7-day case also passed alone with forks). No test or quality gate was removed.
- Manager: 31 focused timeline/payment/refund/typography tests passed, scoped
  ESLint and typecheck passed. The broad parallel local attempt had timing failures;
  the same changed timeline cases passed in the focused rerun.
- Couple web: 35 collaboration/typography tests passed; typecheck passed.
- PRM-app: flutter analyze reported no issues and all 130 Flutter tests passed.
- Browser: real local Next pages with mocked read-only API responses verified
  disabled 0/50/100 percent options before cancellation, automatic 5,000,000 VND
  for the 50 percent case after cancellation, archive navigation and pre-deposit
  Couple cancellation visibility. Manager and Couple pages were inspected at
  390 px and 1440 px, using Be Vietnam Pro with no horizontal overflow. Socket
  connections were deliberately blocked; these are UI checks, not live provider
  or deployed application acceptance.
