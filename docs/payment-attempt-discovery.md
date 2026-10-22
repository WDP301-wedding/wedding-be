# Recovering existing payment attempts

Owner requested a shared deposit and balance recovery fix on 2026-10-22 after the
deployed website returned `409 PAYMENT_ATTEMPT_ACTIVE` without showing the existing
deposit in a fresh browser session. This extends the existing
[reopen/expiry contract](./payment-attempt-reopen-and-expiry.md); it does not change
amounts, settlement authority, expiry policy or payment idempotency.

## Discovery contract

`GET /api/v1/bookings/{bookingId}/payments/active` requires bearer authentication.
It returns `BillingActiveAttemptsResponse`, with `Cache-Control: no-store`:

```json
{
  "data": {
    "attempts": [
      {
        "paymentAttemptId": "22222222-2222-4222-8222-222222222222",
        "status": "UNKNOWN",
        "purpose": "DEPOSIT",
        "amountVnd": 21000000,
        "applicationStatus": null,
        "expiresAt": "2026-10-22T16:00:00.000Z"
      }
    ]
  }
}
```

The example uses synthetic identifiers. The server returns at most two attempts,
ordered by creation date then ID, descending. Discoverable states are CREATED,
PENDING and UNKNOWN, including expired attempts. A VNPay SUCCEEDED attempt is also
discoverable with `applicationStatus=PENDING` while its payment ledger entry or
deposit application is missing. Applied successes and failures are excluded.

| Reader                                          | Deposit | Balance |
| ----------------------------------------------- | ------- | ------- |
| Owning Couple, stored RESTRICTED grant          | Yes     | No      |
| Owning Couple, stored FULL grant                | Yes     | Yes     |
| Stored active Manager                           | Yes     | Yes     |
| Foreign account, Staff without Couple ownership | No      | No      |

Stored account roles and consultation grants decide authority; token role claims
cannot elevate access. Authorization is checked before the query and again before
returning data. Existing 401/403/404 semantics apply. Strict safe response fields
exclude provider evidence, signing material, command IDs and checkout parameters.
Discovery does not query VNPay, create a checkout, post ledger entries or release
reservations. An empty list does not prove that an earlier payment failed.

## Client recovery and status

On opening/refreshing payments, the website discovers server attempts before
enabling a fresh payment. A server attempt takes precedence over browser metadata.
It then calls the existing authorized
`GET /bookings/{bookingId}/payments/{attemptId}` to reconcile and recover the
original unexpired `checkoutUrl`. The URL receives the same origin/path validation
as the create-checkout response. Discovery/status errors do not enable a new
payment. A race returning `PAYMENT_ATTEMPT_ACTIVE` triggers discovery, not a second
POST. Both DEPOSIT and BALANCE use the same path.

The local journal preserves its original key/body through uncertain POST results.
Server recovery associates the recovered attempt with that journal; only verified
FAILED or fully applied SUCCEEDED completes it. A fresh intent can then use a new
key. Older status responses that omit a URL retain a known matching link or permit
replay of the existing saved command, preserving its key and immutable body.

For a persisted SUCCEEDED payment with interrupted downstream application, the
status endpoint now retries the existing idempotent application against retained
verified evidence. It never charges again. Fully applied successes skip this work.
Reconciliation continues to require verified failure/nonpayment evidence for
expiry release. Unverified outcomes remain UNKNOWN and continue blocking a new
payment.

## Rollout and evidence

No migration or configuration change is required. Deploy the additive backend API
before the updated website; the website fails closed if discovery is unavailable.
Regenerate the website API types from the exact committed backend OpenAPI artifact.

Tests use disposable local PostgreSQL and controlled VNPay transport. Local browser
checks use synthetic HTTP fixtures and never pay. They do not prove deployed
provider readiness or a genuine new VNPay settlement. Deployment and direct deployed
browser verification remain separate gates. The original live booking and its
payment evidence must be preserved.
