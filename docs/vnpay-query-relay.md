# VNPay sandbox query recovery — 23 October 2026

The owner authorized continued sandbox checkout testing, recovery mechanisms and
bounded database repair on 23 October. No real-money payment is in scope.

The stuck deposit has an UNKNOWN attempt with no retained provider evidence. A
workstation query received a valid VNPay HMAC response: response code 00 and
transaction status 02 (FAILED), about 203 ms. A one-off probe in the existing
Render Singapore service resolved the same IPv4 address, but HEAD and POST each
failed with `UND_ERR_CONNECT_TIMEOUT` at about 10.5 seconds. The application
previously stopped at its five-second deadline and retained UNKNOWN correctly.
This proves a server-to-provider connectivity failure; it does not identify
which network operator blocks the connection.

The website now relays querydr through its server runtime. The backend retains
the merchant secret, constructs a signed query from the immutable checkout and
verifies the raw signed response itself. ReturnURL parameters never settle money.
The relay cannot select a provider URL, amount, merchant or original order date.

- `GET /bookings/{bookingId}/payments/{attemptId}/query` requires stored booking
  access: restricted deposit, full balance, or Manager. It returns
  `{data:{request:{...signedQuery}}}` or `{data:{request:null}}` for terminal or
  non-VNPay attempts. Never log this signed request.
- Query preparation atomically claims a database lease for 305 seconds. Other
  API instances return 429 `PAYMENT_QUERY_COOLDOWN` with `Retry-After: 305`.
  This prevents the sandbox's five-minute duplicate-query response 94.
- `POST /bookings/{bookingId}/payments/{attemptId}/evidence` accepts only
  `{response: Record<string,string>}`. Authorization is rechecked; existing HMAC,
  correlation, amount, immutable evidence, serialized transition and idempotent
  ledger/deposit application rules apply to deposit and balance alike.
- `GET .../payments/{attemptId}?reconcile=false` reads the original status and
  unexpired checkout without querying VNPay or consuming its query window.
  Terminal success may still retry the existing idempotent downstream application.
- The website uses passive reads for an existing unexpired checkout. Explicit
  status checks use the relay. During a query cooldown it reads persisted status
  instead of calling the provider again. Expired active attempts can be reconciled
  when reopened. Transport or unverified responses cannot release an attempt.

The additive `BillingVnpayQueryLease` migration changes no payment history and
requires no backfill. Old API consumers keep their existing direct-query route.
Rollback application code can leave this coordination table in place.

Offline tests cover relay proof validation, failure release, full/restricted
authorization, cross-instance leases and exactly one payment/application on replay.
Live NCB balance settlement through the corrected Render merchant IPN is now
proven. The old UNKNOWN deposit was recovered using a provider-verified operator
query. The final Vercel runtime's nonterminal provider-query round trip remains
unverified; see the [deployment and settlement evidence](../tasks/evidence/vnpay-render-settlement-2026-10-23.md).

Provider references: [querydr protocol](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html),
[status and duplicate-query codes](https://sandbox.vnpayment.vn/apis/docs/bang-ma-loi/).
