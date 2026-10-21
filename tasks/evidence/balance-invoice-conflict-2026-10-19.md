# Balance checkout 409 — diagnosis, 19/10/2026

Status: **confirmed business prerequisite, no runtime patch applied**. The owner
asked to prioritize the backend errors in the payment-page screenshot before the
larger frontend-first remediation. This investigation does not change that plan's
other tasks. [Sanitized receipt](balance-invoice-conflict-2026-10-19.json).

## What failed

Railway serving deployment `6ec27e24-359b-40c7-b67f-6e712a56617f`, source
`6626a3a44b306300fee78a6509e8fb4cfb2099e0`, recorded:

| Vietnam time | Operation | Code | Request ID |
| --- | --- | --- | --- |
| 12:18:04 | POST balance | INVOICE_FINALIZATION_REQUIRED | `9b5414c2-cec3-4a58-ba3e-74a9cc3729d7` |
| 12:18:17 | POST balance | INVOICE_FINALIZATION_REQUIRED | `b7ccb727-2d05-4aff-a5cf-ebe48aef8f11` |
| 12:21:02 | POST balance, later repeat | INVOICE_FINALIZATION_REQUIRED | `1a37aa68-caee-4296-a9c7-8d781b800ee3` |

These are 4xx completion logs on the balance route, consistent with the screenshot's
HTTP 409s. Request IDs are from server logs; the screenshot does not expose its
IDs, so exact browser-to-log ID matching is unavailable for that screenshot.

Refresh denials at 12:17:00 and 12:17:02 have code INVALID_OR_EXPIRED_TOKEN.
A successful login at 12:17:27 is followed by successful refreshes at 12:17:30,
12:17:41 and 12:17:46. These logs do not establish a backend refresh defect or
whether the earlier token was absent, expired or revoked. Do not disable refresh
validation to remove expected anonymous/revoked-session 401 responses.

## Read-only state verification

The booking explicitly visible in the screenshot is
`984bd852-462f-4ede-854a-436b108a1851`, the retained synthetic historical fixture.
Two operator Prisma transactions used `SET TRANSACTION READ ONLY`; no state was
initialized or repaired. They confirm:

- CONFIRMED booking dated 16/10/2026 with a full commercial contract.
- No final-invoice current revision and **zero final-invoice revisions**.
- Effective commercial revision `1ba45fbe-6301-4057-942f-53658c333236`, total
  **17,500,000 VND**, zero approved appendices.
- Expense draft revision 0, zero lines/total; preview final total **17,500,000 VND**.
- Billing revision 2, settled net paid **5,250,000 VND**, outstanding
  **12,250,000 VND**, no credit or unresolved CREATED/PENDING/UNKNOWN attempts.

This is a preview, not an issued invoice or proof a payment provider moved money.
The fixture's historical manual settlement remains synthetic accounting evidence.

The account supplied earlier in this chat successfully authenticated but has no
access to this fixture: proposal GET returned concealed 404. No access grant was
changed or bypassed through a public API. Operator-only metadata inspection above
is distinct from browser authorization verification. Audit session logout returned
204, request `e5aceb45-6600-4560-bb19-dc1c3f4da0c3`.

## Why a bypass is not a bug fix

[The settlement hand-off](../../docs/be11-16-commercial-settlement.md#balance-and-compatibility)
explicitly requires the current final invoice for new full-contract BALANCE
attempts. [The reader](../../src/modules/payments-billing/infrastructure/invoice-balance.reader.ts)
rejects the absent invoice with INVOICE_FINALIZATION_REQUIRED. The existing native
[regression case](../../tests/integration/commercial-step6-api-cases.ts) named
`requires finalization before a full-contract balance payment` asserts this exact
409; the next case covers a zero-expense finalized invoice and invoice-pinned
balance. These existing tests were inspected, not rerun for a no-code diagnosis.

There is no evidence that this guard misclassified the booking. Removing it,
treating a full contract as legacy, auto-finalizing on a Couple payment click,
or inserting an invoice/settlement directly would change the agreed lifecycle.
Invoices are immutable and Manager finalization is a distinct business operation.

## Concrete resolution options

1. Preserve the rule and finalize this **specific synthetic** invoice through the
   authorized Manager owner API, after explicit confirmation. Prepared preview:
   total 17,500,000 VND, zero incidental expenses, paid 5,250,000 VND, remaining
   12,250,000 VND. Re-read all expected revisions before issuing it. This does not
   itself authorize creating a gateway payment or recording settlement.
2. Preserve fixture data and implement an additive backend eligibility contract,
   so frontend can state that finalization is required before offering balance
   checkout. That is an API/consumer improvement; the POST 409 remains correct
   until a Manager finalizes. Frontend must consume the new contract in its phase.
3. If collecting before final invoice is desired, obtain the owner's explicit
   business amendment and specify how advances, final expenses, invoice pinning,
   unknown attempts, credits and refunds interact before implementation.

The user was asked which interpretation they intend. No application source,
frontend, migration, deployment, final invoice, payment or business history was
modified. Only this diagnosis and its receipt were added. Do not report the
checkout as repaired or the invoice as finalized from this evidence.
