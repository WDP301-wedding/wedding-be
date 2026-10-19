# VNPay attempt reopening and expiry recovery

Owner authorized implementation on 2026-10-19 of the frontend request referring to
`main@2d2a1d4` (PR #76). This is an amendment to ADR-006's original missing-order
policy, not a claim that VNPay guarantees settlement finality after 15 minutes.

## API and authorization

The existing authenticated route remains
`GET /api/v1/bookings/{bookingId}/payments/{attemptId}`. No new route or request field.

| Reader                     | DEPOSIT            | BALANCE |
| -------------------------- | ------------------ | ------- |
| Owning Couple              | RESTRICTED or FULL | FULL    |
| Manager                    | Allowed            | Allowed |
| Other account / Staff-only | Denied             | Denied  |

The additive `data.checkoutUrl` field has type string, format URI, and is optional.
It is returned only for a VNPay attempt whose reconciled status is CREATED, PENDING
or UNKNOWN and whose `expiresAt` is strictly later than the server's current time.
It is omitted for terminal/expired attempts, manual payments, missing checkouts or
an unavailable adapter. Existing missing-checkout errors remain unchanged.

The URL is reconstructed from immutable checkout parameters, with the current
merchant signing key. With an unchanged key it matches the POST URL exactly. No
attempt, expiry, amount, return URL or `vnp_TxnRef` is regenerated. The URL necessarily
contains its checkout signature; do not log it. Authorization is checked again
after reconciliation, before returning it.

Example data (other existing fields remain unchanged):

```json
{
  "paymentAttemptId": "10000000-0000-4000-8000-000000000001",
  "status": "UNKNOWN",
  "purpose": "BALANCE",
  "amountVnd": 35000000,
  "applicationStatus": null,
  "expiresAt": "2026-10-19T15:15:00.000Z",
  "checkoutUrl": "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?..."
}
```

Frontend regenerates its client, restores the existing attempt ID and opens this
URL after its existing VNPay-origin check. Removing the field is not evidence of
payment failure. After a FAILED response, refresh billing eligibility before
starting a new intent with a new idempotency key. Retries of one intent retain their
original key. POST still revalidates eligibility, current invoice and outstanding.

## Reconciliation policy

Protocol: VNPay PAY/querydr 2.1.0, existing fixed sandbox endpoints. Reconciliation
is triggered by the existing attempt GET/internal port; no scheduler or Manager
override endpoint is introduced. The frontend document allowed either automatic
resolution within reconciliation or a manual endpoint; this implements the former.

| Verified query evidence                                                                      | Before or at expiry + 15 minutes | Strictly after expiry + 15 minutes |
| -------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------- |
| Success: response/status 00/00, real transaction and valid payment date                      | SUCCEEDED                        | SUCCEEDED                          |
| Terminal failure: response/status 00/02                                                      | FAILED                           | FAILED                             |
| Missing order: response 91, matching merchant/order, no positive transaction or payment date | UNKNOWN                          | FAILED                             |
| Unpaid: response/status 00/01, transaction 0, no payment date                                | UNKNOWN                          | FAILED                             |
| Timeout, bad signature, malformed/correlation/amount conflict, other statuses                | UNKNOWN                          | UNKNOWN                            |

For missing orders, bank/amount/status/type fields can be absent. The reply must
still carry an authenticated matching merchant and order, command querydr and a
valid response ID. Supplied type/status must be empty or 01. A supplied positive
amount must match the attempt; missing/zero amount uses the persisted amount for
local evidence association, never as proof of a settlement. A positive transaction
or payment date is never classified as absent/unpaid. Error response 94 and other
provider failures never release an attempt.

Authenticated unpaid replies may have an empty/missing bank code and payment date;
their amount must still be positive and match the attempt, and transaction number
must be zero within the protocol's 15-digit limit. Nonempty invalid bank/date fields
and malformed transaction references remain unverified/UNKNOWN.

Expiry decisions use the existing FAILED state and VERIFIED_FAILURE transition.
The audit records `resolutionReason=EXPIRED_UNPAID`, `nonPaymentReason` and the original
authenticated `sourcePayloadHash`. A domain-separated decision hash distinguishes
the expiry decision from the identical provider reply previously retained as
UNKNOWN. Prior evidence remains immutable; no provider success is invented.

Evidence recording, terminal transition and DEPOSIT intent release share the existing
serialized booking transaction. Conflicting query/IPN races cannot overwrite a
terminal result. A success already committed during the query wins; it is applied
once. BALANCE eligibility naturally unblocks after FAILED, if other conditions hold.
Deposit release follows existing Booking rules; a fresh deposit may require a new
valid slot hold and current approvals.

An authenticated success arriving **after an expiry failure has committed** remains
conflicting evidence under the existing terminal-state policy and requires operator
reconciliation. It does not silently rewrite FAILED or automatically confirm a
released/reallocated booking. The grace period reduces this risk, not eliminates it.
Transport/signature failures can still retain UNKNOWN indefinitely by design.

## Persistence and verification

No schema migration: reuse immutable checkout/provider evidence, existing attempt
states, ledger, intent release and audit metadata. Applied migrations are unchanged.
Money remains integer VND; no totals, invoice or contract history are rewritten.
No automatic bank refunds or payment generation are added.

Regression tests cover repeated reopening, exact expiry/grace boundaries, immutable
UNKNOWN-to-expiry evidence replay, sparse signed missing orders, deposit release,
balance eligibility/new checkout, invalid/mismatched evidence, success after expiry
and a query/IPN race. Provider transport is controlled and PostgreSQL databases are
disposable/local. Live sandbox and deployed browser verification remain separate
acceptance gates; offline success is not provider/deployment readiness.

See [the dated verification record](../tasks/evidence/payment-attempt-reopen-expiry-2026-10-19.md)
for the exact tests, coverage, OpenAPI digest and whole-suite resource retries.

Sources: [official querydr response/status definitions](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html)
and [official response-code table](https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/).
