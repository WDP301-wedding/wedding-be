# ADR-006: Durable VNPay evidence and reconciliation

## Status

Implemented technical realization of SPEC-04 Sections 7, 8 and 11 on 2026-10-08.
Final module acceptance and HTTP publication remain with W6-W8. This decision
preserves the approved money, reservation and account-promotion policies.

## Context

Provider acknowledgement must survive restart. A redirect cannot prove payment.
Duplicate or reordered evidence must not append another payment or change terminal
evidence. Unavailable status queries cannot prove failure. Proven money must remain
recoverable if Booking, Identity or money application is temporarily unavailable.

## Decision

- Persist the immutable checkout parameters without its signature or hash secret.
  Reserve the attempt through W3, save its checkout and transition to PENDING before
  returning the URL. Replay retains the original IP, transaction date, expiry and
  return URL. No provider network operation occurs inside a database transaction.
- Verify the official PAY/IPN canonical form and querydr pipe checksum separately.
  Reject ambiguous/duplicate decoded query keys and verify HMAC-SHA512 before
  normalizing values. Amount scaling uses exact integer arithmetic. Bind the
  provider order to the persisted attempt and merchant. IPN normally omits currency;
  its checkout fixes VND. A signed different currency is retained as CONFLICT with
  a minimal CURRENCY audit reason, never applied as money. Querydr cannot supply an
  unsigned currency override.
- Store normalized verified evidence, canonical payload hash and decision in
  `BillingProviderEvidence`. Store a merchant/transaction claim separately in
  `BillingProviderTransaction`. Normalize numeric transaction aliases; transaction
  zero represents an unresolved/nonsettled provider reference and is never claimed.
  Claims prevent reuse across attempts. Exact channel/order/hash replay returns the
  stored decision. Changed positive-transaction IPN payloads and contradictory
  terminal proofs are quarantined. Query/IPN evidence for the same settlement may
  agree without replacing the first terminal evidence or recording another payment.
- Commit evidence, attempt transition and any verified failure release/UNKNOWN
  pinning in the shared booking boundary. Only then acknowledge IPN. Preserve
  minimal IDs, amount, outcome and decision; do not persist raw callbacks, bank/card
  values, signatures or merchant secrets. SQL protects immutable evidence, checkout
  and claims, as well as claim-to-proof linkage.
- Apply proven success through ADR-005's recoverable worker. A downstream failure
  does not erase the proof or acknowledged success. Reconciliation can retry the
  original settlement date without querying an already terminal attempt. Historical
  unapplied terminal attempts with no provider proof remain application PENDING.
  Existing immutable completion markers still prove completed application without
  another provider query or owner write. The forward migration invents no historical
  checkout or proof.
- Resolve success only when both payment response/status codes are 00. Conservatively
  release failure only for verified transaction status 02, with a failed IPN response
  or a successfully processed querydr response. Other statuses, missing orders,
  malformed responses, signature/correlation conflicts and transport failure remain
  UNKNOWN. Expiry alone never releases the reservation.
- Keep settings in backend runtime configuration. A complete merchant code, secret,
  return URL and server IP is required to enable the adapter. The transport posts
  only to the fixed sandbox query endpoint, rejects redirects, limits response bytes
  and uses an abort deadline. Tests inject controlled transport and keys and make no
  live VNPay calls. ReturnURL verification has no persistence side effects.

## Consequences and proof

IPN acknowledges durable receipt; the application's payment status and downstream
application status are separate. W6 authorizes and exposes those safe statuses.
No new public owner contract, HTTP route, API digest or business event is published
by W4. Manager reconciliation remains necessary for retained late money that Booking
cannot apply. The existing three Billing business events remain unchanged.

Migration `20261008008000_vnpay_provider_evidence` adds three Billing tables without
changing previous migrations or inferring historical evidence. The upgrade rehearsal
preserves W3 money, completion markers, owner grants, audit and outbox exactly.

Proof: `vnpay.protocol.test.ts`, `vnpay.gateway.test.ts`, `vnpay.service.test.ts`,
`tests/integration/payments-billing/vnpay.test.ts`, `vnpay-evidence.test.ts`, and
`vnpay-upgrade.test.ts`. The real integration includes concurrent IPNs/querydr,
timeout-after-IPN, expiry, changed payload/currency, transaction reuse, proof-commit
faults, money-write recovery, same-account promotion and retained late money.

Authority: [SPEC-04](../../SPEC-payments-billing.md),
[ADR-005](0005-recover-deposit-application-after-durable-settlement.md),
[Billing evidence](../../tasks/evidence/payments-billing.md),
[official PAY documentation](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html),
and [official querydr documentation](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html),
checked 2026-10-08.
