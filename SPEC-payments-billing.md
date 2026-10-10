# Specification: Payments and Billing

> Current amendment: [confirmed backend scope](./docs/backend-scope-2026-10-10.md) and [commercial extensions](./SPEC-commercial-contracts.md). Completed implementation evidence below is historical; new names/catalog/contract/invoice rules are separate backend extension tasks. The 2026-10-10 amendment governs conflicts with older access, pricing and client requirements.

- Status: **ACCEPTED by the project owner (2026-10-09) — Android native runtime verification remains open**
- Module plan: approved 2026-10-08; [`tasks/plan.md` Section 21](./tasks/plan.md#21-spec-04-payments-billing-bounded-implementation-plan)
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `payments-billing` (`SPEC-04`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: A (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: PRN-006
- Depends on: `booking-lifecycle`
- Consumers: `invitation-studio`, `notifications-automation`, `analytics-dashboard`

### Implementation acceptance record

On 2026-10-09, after reviewing the web screenshots, requesting clearer Vietnamese
payment labels and receiving the explicit Android-runtime limitation, the project
owner stated: "được rồi, nếu test đã ổn, tôi accepted, tiến hành push code".
The refreshed client coverage suites pass (Management 124/124, Public 85/85,
Android 54/54), as do backend contract tests (25/25), client contract checks,
web production builds and Android export. See the
[acceptance evidence](./tasks/evidence/payments-billing.md#owner-acceptance-and-pre-push-verification--2026-10-09).

This records owner acceptance and authorization to publish the existing
`codex/payments-billing` branches. Android native runtime is still unverified;
the two native-review checklist items in W7/W8 remain open. Export and automated
tests do not prove native behavior. PB-C4's technical checklist is not marked
fully verified, and this approval does not authorize a merge or deployment.

## 1. Purpose and ownership

This module owns payment intents/attempts, VNPay sandbox verification, manual payment
evidence, settlement, invoices, receivable charges, refunds, reconciliation, and all
authoritative money totals. Amounts are integer VND in APIs and `Decimal(18,0)` in
PostgreSQL. Payment, refund, and charge facts are immutable; corrections are new facts.

It does not calculate booking eligibility, alter booking phases directly, promote
access directly, own print quotation content, or accept a client amount as authority.

## 2. Financial model and state contract

| Record            | Owner-controlled fact                                                | Required invariant                                        |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Payment attempt   | purpose, amount snapshot, provider/manual evidence, processing state | Persist intent before provider interaction.               |
| Payment           | proven settlement                                                    | One immutable `paymentId`; callbacks cannot duplicate it. |
| Receivable charge | accepted source revision and amount                                  | Unique `(sourceType, sourceRevisionId)` for print.        |
| Refund            | source payment, amount, reason, evidence                             | Never exceeds available settled amount.                   |
| Invoice view      | charges, paid, refunded, outstanding                                 | Derived from ledger only, never client totals.            |

A deposit uses `requireDepositEligibility` immediately before creation and settlement;
the amount is returned `depositAmountVnd`. A provider timeout is `UNKNOWN` until
reconciliation proves an outcome and never authorizes a second charge.

## 3. Produced contracts

```ts
interface BillingReader {
  requireDepositSettlement(bookingId: string): Promise<{
    paymentId: string;
    amountVnd: number;
    settledAt: Date;
  }>;
  getBookingReceivables(bookingId: string): Promise<{
    acceptedChargesVnd: number;
    paidVnd: number;
    refundedVnd: number;
    outstandingVnd: number;
  }>;
}

interface BookingChargeRegistrar {
  registerAcceptedCharge(input: {
    bookingId: string;
    sourceType: 'PRINT_ORDER';
    sourceRevisionId: string;
    amountVnd: number;
    acceptedAt: Date;
  }): Promise<{ receivableChargeId: string; replayed: boolean }>;
}
```

The registrar atomically claims the source revision. Identical replay returns
`replayed: true`; changed booking/amount/date is `409 RECEIVABLE_SOURCE_CONFLICT`.
Readers disclose only minimum data for an already-authorized booking.

## 4. Consumed contracts and emitted events

| Provider          | Contract                                           | Boundary rule                                                   |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| booking-lifecycle | `BookingLifecycleReader`, `BookingDepositRecorder` | Recheck before money effect; record only proven settlement.     |
| identity-access   | `CoupleAccessPromoter`                             | Promote same account using successful deposit `paymentId`.      |
| invitation-studio | none before charge                                 | It invokes this module only after freezing commercial revision. |

The module emits `billing.payment-succeeded`, `billing.receivable-charge-accepted`, and
`billing.refund-recorded` v1. The ledger row and event outbox are transactional; each
payload conforms to the baseline minimum and excludes credentials/callback bodies.

## 5. Authorization and HTTP contract

Couple users start an eligible deposit and read their booking's safe billing view.
Managers record approved manual evidence, reconcile, and refund. An authenticated
restricted prospect may create a deposit intent for their own consultation only when
current eligibility passes; `COUPLE` role or `FULL` access is not required for that
specific action. Staff and public/guest links cannot mutate billing. VNPay callback input is
untrusted until signature and existing-attempt correlation are verified.

Specified routes are `/bookings/{bookingId}/payments/deposit`, `/billing/callbacks/vnpay`,
`/management/billing/payments/manual`, `/management/billing/refunds`, and
`/bookings/{bookingId}/billing`. Money commands require `Idempotency-Key`; callbacks
deduplicate by provider transaction identity and canonical payload hash. Stable errors:
`DEPOSIT_NOT_ELIGIBLE`, `PAYMENT_EVIDENCE_CONFLICT`, `PAYMENT_CALLBACK_INVALID`,
`PAYMENT_OUTCOME_UNKNOWN`, and `RECEIVABLE_SOURCE_CONFLICT`.

## 6. Failure, audit, and acceptance

- Intent claim, callback decision, settlement, booking confirmation, access promotion,
  and outbox effects are recoverable and reconciled without duplicate charges.
- In-flight duplicates return `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`; changed-body key
  reuse is `422 IDEMPOTENCY_KEY_REUSED`.
- Refund recording locks/rechecks available balance; it never changes historical payment
  or demotes Couple access.
- Audit initiation, verification decision, settlement, manual evidence, reconciliation,
  charge, invoice, and refund without secrets, bank/card data, or raw callback payloads.

Acceptance proves callback duplication/reordering, timeout reconciliation,
eligibility-supersession race, one accepted print charge, refund race, booking/identity
integration, immutable receivable totals, PRN-006 reporting, and OpenAPI drift.

## 7. Accounting decisions and additive ports

| Value              | Exact definition                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| acceptedChargesVnd | Sum of immutable accepted base-booking and print charges minus accepted credit adjustments. Never negative.      |
| paidVnd            | Sum of proven positive settled payments, including deposit and balance. Failed/pending attempts contribute zero. |
| refundedVnd        | Sum of recorded completed manual refunds; pending refund intent contributes zero.                                |
| netPaidVnd         | paidVnd − refundedVnd.                                                                                           |
| outstandingVnd     | max(acceptedChargesVnd − netPaidVnd, 0).                                                                         |
| creditVnd          | max(netPaidVnd − acceptedChargesVnd, 0); visible for Manager reconciliation, never an automatic refund.          |

Booking owns the accepted immutable commercial snapshot. Before confirming settlement,
billing records the base charge once by that commercial revision through its own internal
ledger operation; booking base amount is not duplicated as both a base charge and a
deposit charge. Deposit is payment toward the base charge. Remaining-balance payments
reduce the same outstanding amount. Print charge registration uses the unchanged
`BookingChargeRegistrar`; cancellation/replacement credits use additive
`BookingChargeAdjustmentRegistrar` (baseline Section 21). Credit and charge records
are append-only, idempotent by immutable source, and linked to their original evidence.

Refund amount must be positive, no greater than unrefunded source settlement, and no
greater than the approved refundable amount under the recorded cancellation/credit
decision. Manager explicitly supplies reason/evidence; system does not automatically
refund or demote access. Initial refund interface is manual only. Billing owns
`BillingReportingReader` and publishes the readonly row/schema described in Section 21.

Attempt states: `CREATED -> PENDING -> SUCCEEDED | FAILED | UNKNOWN`;
`UNKNOWN` changes only from proven evidence/reconciliation. `SUCCEEDED` is terminal;
duplicates cannot change it. Callback with a different amount/currency/booking or a reused
provider transaction for another attempt is quarantined as evidence conflict.

## 8. Deposit orchestration and verified callback contract

1. Authorize current restricted/full access to the own booking. Require exact requested
   timeline revision; derive amount from booking, never request body.
2. Atomically claim one durable idempotent attempt and reserve booking through
   `BookingDepositIntentCoordinator.reserve`. Missing reservation rolls back attempt
   creation; the provider checkout URL is not exposed before commit.
3. Persist checkout intent before provider call. Initial intent expiry is 15 minutes.
   Distinct client keys cannot open multiple unresolved deposit intents for one booking.
4. Verify callback signature and correlate merchant order/transaction ID, VND amount,
   currency, and current persisted attempt. Persist success/failure evidence once.
5. Apply base charge, payment, booking deposit recorder, and identity promotion with a
   shared application transaction or durable recoverable application state. HTTP reports
   application pending until booking and promotion both succeed.
6. Unknown outcomes hold reservation and reconcile; only verified terminal failure may
   release it. Exact successful payment replay bypasses fresh-payability rejection.
   Late money received is retained in ledger even when Manager reconciliation is needed.

The owning adapter must specify sandbox merchant configuration, canonical signing input,
verification, status query, and callback response codes from official VNPay integration
documentation during adapter implementation. Signatures are verified over provider-defined
canonical data before trusting normalized values; HTTP redirect success is never evidence.
No guessed signing algorithm/field mapping is allowed. Keys/merchant secrets are backend
environment inputs. Contract-ready provider tests include official sandbox fixtures.

## 9. HTTP schema hand-off and races

| Method/path                               | Strict request / response                                                                                            | Authorized actor                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| POST /bookings/{id}/payments/deposit      | timelineRevisionId; result paymentAttemptId/status/checkoutUrl/expiresAt                                             | Own restricted/full access; no amount or role accepted.                                                              |
| GET /bookings/{id}/payments/{attemptId}   | Safe status, amountVnd, purpose, downstream application status                                                       | Own restricted/full booking grant or Manager.                                                                        |
| POST /bookings/{id}/payments/balance      | expectedBillingRevision; server full outstanding amount                                                              | Own FULL account or Manager.                                                                                         |
| POST /management/billing/payments/manual  | bookingId, purpose, amountVnd, settledAt, evidenceReference (1–120), reason                                          | Manager; deposit still requires eligibility/reservation; balance cannot exceed authorized outstanding.               |
| POST /management/billing/refunds          | sourcePaymentId, amountVnd, expectedBillingRevision, reason, evidenceReference                                       | Manager; refundable limit checked transactionally.                                                                   |
| POST /management/billing/refund-approvals | bookingId, expectedBillingRevision, approvedRefundableVnd, basis, reason, evidenceReference; result refundApprovalId | Manager; CREDIT basis names a credit ledger entry, CANCELLATION uses a server-resolved immutable reporting snapshot. |
| GET /bookings/{id}/billing                | Totals above, payment/charge/refund history with pagination and billingRevision                                      | FULL own booking or Manager; restricted actor sees deposit status only.                                              |
| GET /billing/callbacks/vnpay              | Provider-defined IPN query; provider-required acknowledgement                                                        | Signature/correlation, not user role; authoritative GET IPN as specified below.                                      |

Callbacks use provider-specific verification/deduplication rather than a client
`Idempotency-Key` requirement. Client/server mutations use the platform durable key.
Refund approval is an explicit durable decision before refund recording. It checks
the current billing revision and available cancellation/credit budget without
recording a refund or changing ledger totals; retries replay the committed decision.
Balance initiation serializes against another in-flight balance/manual payment to prevent
concurrent collection of the same outstanding amount. Every true settlement is recorded;
a late duplicate business payment becomes explicit credit/reconciliation, not data loss.

Credit-adjustment conflicts use `RECEIVABLE_ADJUSTMENT_CONFLICT` (409); source money
mismatch uses `PAYMENT_EVIDENCE_CONFLICT` (409); invalid signatures use
`PAYMENT_CALLBACK_INVALID` (400); reconciliation reads return status `UNKNOWN`
instead of pretending a timeout means failure. Private unowned reads use concealed 404.

## 10. Parallel implementation and acceptance matrix

| Slice                                        | Allowed overlap                                                             | Required real readiness                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Payment/refund pure rules, ledger port tests | Booking implementation and client work                                      | Reviewed amount/eligibility/accounting DTOs.               |
| VNPay adapter/parser/status polling          | Own domain and booking fakes                                                | Sandbox fixtures/config before real provider checkpoint.   |
| Ledger persistence/manual refund             | Different module files                                                      | Serialized migration lane; real PostgreSQL locking.        |
| Deposit integration/promotion                | May begin when specific Booking ports are ready, before all Booking screens | Real reservation/recorder/identity; mocks cannot close it. |
| Billing Web/App presentation                 | Local fixtures, then digest-based generated client                          | Real billing API for end-to-end acceptance.                |

Proposed waves: ledger and accounting; reservation/deposit; verified callback/reconciliation;
manual payments/refunds/credit adjustments; billing/invoice HTTP/OpenAPI; independent
clients; acceptance (seven). Immutable invoice has an invoice number, issuedAt, source
ledger revision, integer totals and line sources; issuing it does not collect money.

| Requirement/contract | Required evidence                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PRN-006              | Exact print commercial source registers once; appears in billing/invoice.                                            |
| Deposit promotion    | Restricted actor succeeds only when eligible; edit race denied; same account becomes FULL.                           |
| Accounting           | Base plus print, deposit plus balance, cancellation credit and manual refund produce exact totals.                   |
| Retry/evidence       | Same and different-body keys, reordered callback, unknown timeout, crash between settlement/confirmation/promotion.  |
| Concurrency          | Two refunds cannot exceed source; two balance intents cannot collect same outstanding; real provider contract tests. |

## 11. Verified VNPay sandbox mapping

Use API 2.1.0 with `vnp_Command=pay`, `vnp_CurrCode=VND`,
`vnp_TxnRef=paymentAttemptId`, and `vnp_Amount=amountVnd*100`.
Create/expiry dates use yyyyMMddHHmmss in GMT+7. Sandbox checkout is
`https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`.
Canonical checksum sorts parameter names; use HMAC-SHA512 and the official
parameter encoding. Exclude `vnp_SecureHash`/`vnp_SecureHashType` from verification.
Reject duplicated query keys rather than ambiguous parsing. Verified success requires
both response code and transaction status `00`; IPN is authoritative, ReturnURL is display.

IPN acknowledgement is HTTP 200 JSON `{RspCode, Message}`: 00 processed, 02 already
processed, 01 unknown order, 04 amount mismatch, 97 invalid signature, 99 processing
failure. Acknowledgement means durable evidence was recorded; downstream application
may reconcile separately. This provider-specific body is an explicit exception to the
normal application error envelope.

Source: [official VNPay PAY integration documentation](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html),
checked 2026-10-06. Adapter tests include encoding/amount/signature/IPN duplicate fixtures
and keep credentials/configuration out of source.

### W4 querydr mapping verification (2026-10-08)

The sandbox status endpoint is
`https://sandbox.vnpayment.vn/merchant_webapi/api/transaction` (POST JSON).
Use version 2.1.0 and command `querydr`. Request HMAC-SHA512 signs these pipe-separated
fields in order: RequestId, Version, Command, TmnCode, TxnRef, TransactionDate,
CreateDate, IpAddr, OrderInfo (all prefixed `vnp_`). TransactionDate is the persisted
checkout creation date; each status request has a fresh alphanumeric RequestId.

Response verification signs ResponseId, Command, ResponseCode, Message, TmnCode,
TxnRef, Amount, BankCode, PayDate, TransactionNo, TransactionType, TransactionStatus,
OrderInfo, PromotionCode, PromotionAmount in that order, preserving empty segments.
TransactionType must be payment `01`. Query ResponseCode `00` proves the query was
processed; settlement still requires TransactionStatus `00`. Treat status `02` as
verified failure only with a successfully processed query. Other unresolved or
contradictory statuses and unavailable/missing/unverified responses remain UNKNOWN.
Expiry is not failure evidence. ReturnURL remains display-only.

Source: [official querydr documentation](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html).
The transport uses a fixed sandbox URL, bounded response and timeout. Controlled
tests verify request/response checksum order independently and never call VNPay.

## 2026-10-10 Backend Extension

Extend PRN-006/CTR-007 and FIN-001–006: register contract obligations/appendix deltas once, preserve contracted print linkage, support post-event Manager incidental drafts, immutable final invoice/adjustments and net-paid/credit accounting. Use BE-10/12–16. Existing BASE/PRINT settlements are preserved, never charged twice.

Authority and validation: [commercial specification](./SPEC-commercial-contracts.md),
[confirmed scope](./docs/backend-scope-2026-10-10.md) and
[active backend tasks](./tasks/backend-revision-todo.md). These requirements do not
claim that the pending extension is already mounted in the generated API.
