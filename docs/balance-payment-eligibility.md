# Balance checkout eligibility

Owner-approved backend extension, 2026-10-19. This implements the selected resolution
for balance checkout returning `409 INVOICE_FINALIZATION_REQUIRED`: expose the
prerequisite on the existing billing read without bypassing invoice finalization.
It does not finalize an invoice, create a checkout or record payment on a GET.

## API and authorization

`GET /api/v1/bookings/{bookingId}/billing` retains its parameters, totals, history,
pagination, `Cache-Control: no-store` and authorization. It adds the required output
field `data.balancePaymentEligibility`. No request field, route or migration is added.
The strict schema is published as `BalancePaymentEligibility` in the generated
[OpenAPI](../openapi/openapi.json); clients should regenerate from the published
immutable artifact before consuming the addition. Existing response fields retain
their meanings. Consumers with strict whole-response validators must update those
validators; do not hand-edit generated client types.

| Actor                                          | Access                                                        |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Active Manager                                 | Read booking billing and eligibility                          |
| Owning FULL Couple                             | Read own booking billing and eligibility                      |
| Restricted prospect                            | Not admitted to billing read; deposit status remains separate |
| Unauthenticated, unrelated or Staff-only actor | Existing 401/403/concealed-404 behavior remains               |

Authorization precedes eligibility calculation. Financial facts are read inside the
same serialized read-only booking boundary as the ledger. No cookies, gateway URL,
provider evidence or private payment reference is added to the response.

## Response examples

An approved full contract with no finalized invoice still returns HTTP 200 for the
billing GET. The new field tells the consumer why balance checkout is blocked:

```json
{
  "canPay": false,
  "reasonCode": "INVOICE_FINALIZATION_REQUIRED",
  "nextAction": "WAIT_FOR_FINAL_INVOICE",
  "billingRevision": 2
}
```

After normal Manager finalization, with positive outstanding balance, no unresolved
balance attempt, a supported amount and VNPay enabled in configuration:

```json
{
  "canPay": true,
  "reasonCode": null,
  "nextAction": "PAY_BALANCE",
  "billingRevision": 2
}
```

`canPay` describes **VNPay balance checkout**, not a Manager's manual accounting
permission. The true branch always has null `reasonCode` and `PAY_BALANCE`.
The false branch has one of the following reason/action pairs. Unknown fields and
contradictory states are rejected by the runtime schema.

| reasonCode                            | nextAction               | Suggested frontend behavior                                                    |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `BALANCE_NOT_ELIGIBLE`                | `CONTACT_RESTAURANT`     | Booking phase does not permit balance collection; explain and hide checkout    |
| `INVOICE_FINALIZATION_REQUIRED`       | `WAIT_FOR_FINAL_INVOICE` | Show “Nhà hàng chưa chốt hoá đơn cuối”; disable balance checkout               |
| `FINANCIAL_SOURCE_CONFLICT`           | `CONTACT_RESTAURANT`     | Invoice total and accepted ledger charges disagree; require restaurant review  |
| `PAYMENT_ATTEMPT_ACTIVE`              | `CHECK_EXISTING_PAYMENT` | Use the existing authorized payment status flow; do not start another attempt  |
| `BILLING_BALANCE_LIMIT_EXCEEDED`      | `NONE`                   | Outstanding balance is zero, including credit/overpaid states; no new payment  |
| `PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED` | `CONTACT_RESTAURANT`     | Whole outstanding amount exceeds the existing VNPay bound of 9,999,999,999 VND |
| `PAYMENT_PROVIDER_UNAVAILABLE`        | `CONTACT_RESTAURANT`     | VNPay is disabled in the selected backend configuration                        |
| `STALE_BILLING_REVISION`              | `REFRESH_BILLING`        | Historical page is behind the current ledger; fetch the current billing view   |

Only a primary reason is returned. For a current page, order is booking phase →
applicable invoice/total consistency → unresolved attempt → positive outstanding →
gateway amount limit → configured provider. This explains actionable business
prerequisites even when the provider is also disabled. The POST may reject an
unconfigured provider first; consumers must handle its actual error normally.

An unresolved balance includes CREATED, PENDING, UNKNOWN and SUCCEEDED with no
applied payment entry. Expiry alone does not release it. GET does not reconcile or
call a payment provider. `canPay: true` proves neither external provider health nor
provider settlement; configuration presence is not live provider evidence.

As of the owner-approved 2026-10-19 [expiry recovery amendment](./payment-attempt-reopen-and-expiry.md),
the separate payment-attempt GET may resolve authenticated nonpayment after expiry
plus 15 minutes. Refresh this billing GET afterward to obtain the updated `canPay`;
this billing GET itself still performs no provider reconciliation.

## Pagination and freshness

The existing root `billingRevision` and `totals` retain their historical fence.
The nested `balancePaymentEligibility.billingRevision` identifies the **current**
ledger revision at evaluation. If they differ, eligibility is false with
`STALE_BILLING_REVISION`; a consumer must not create a checkout from that old page.
`limit=1` on a current page still calculates eligibility from the whole ledger,
not the visible history slice. Cursors and invalid-fence validation are unchanged.

For `canPay: true`, use the current root revision as `expectedBillingRevision` on
`POST /api/v1/bookings/{bookingId}/payments/balance`, and preserve the same
Idempotency-Key across retries of one intent. A GET does not reserve that revision.
The POST continues to revalidate authority, phase, invoice, billing revision,
unresolved attempts and amount under the write boundary. New intervening state may
produce a 409 even after a true GET; refresh or inspect the existing attempt as
directed by the actual error. Never automatically retry with a new payment intent.

Legacy proposal bookings retain their previous balance behavior without a required
full-contract final invoice. No legacy record is reclassified, backfilled or priced
again. Full-contract final invoice pins and immutable monetary history are preserved.

Unexpected database, malformed invoice, authorization and transaction-scope errors
are **not** converted into business-block responses; they follow the existing
structured error boundary. The new field cannot conceal an operational failure.

## Frontend hand-off and evidence

Frontend integration is a subsequent task: use this field to disable checkout and
show the reason/action, retain the existing handling of errors on POST and reload
after Manager finalization or payment-state changes. Do not infer eligibility from
outstandingVnd alone, or from a booking being CONFIRMED/COMPLETED. No frontend code
is changed by this backend implementation.

The implementation shares financial admission checks between GET and commands.
Unit tests cover strict response states, primary reasons, error propagation and
historical fences. Native PostgreSQL tests cover the full-contract invoice gate,
Manager/owner reads and concealed resources, invoice-backed eligibility, zero balance,
legacy behavior, disabled provider and all unresolved-attempt states.
See [verification record](../tasks/evidence/balance-payment-eligibility-2026-10-19.md)
for exact results and limitations. Local proof is separate from deployment and
external provider acceptance.
