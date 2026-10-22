# VNPay sandbox recovery and Render IPN: 23 October 2026

The owner authorized sandbox NCB checkout, payment recovery, deployment and bounded
database repair. All amounts below are sandbox VND. No real-money transaction was
performed. Historical SPEC/RV evidence remains unchanged.

## Root cause and configuration repair

Render's outbound QueryDr connection timed out, while a workstation received and
verified VNPay's signed response in approximately 200 ms. This establishes a
server-to-provider connectivity problem, without attributing the blocking network.
The merchant portal also retained the retired Railway IPN address. Its authenticated
configuration was inspected and updated to:

`https://wedding-be-render-trial.onrender.com/api/v1/billing/callbacks/vnpay`

Reloading the merchant configuration retained this exact value. An invalid-signature
probe returned HTTP 200 / `RspCode=97`; the subsequent authentic balance IPN below
proves that VNPay reaches this endpoint and the backend accepts valid evidence.
Application environment variables alone cannot change the merchant's IPN setting.

## Old UNKNOWN deposit and retry

Booking: `405e52f9-efdf-47e6-8304-78fd0e4c1a9a`.

- Old deposit attempt `2ea46496-04a9-4da8-b8a6-51cccf76e6dd`, 21,000,000 VND:
  a fresh signed QueryDr response established FAILED. The canonical reconciliation
  service retained accepted QUERY evidence with hash
  `92aaf42835b96596d7bd50226f17f4926c817ae06d43dc98d37e5806cf12f858`.
  No payment entry or deposit application was created; the intent/hold pin released.
- Retry then correctly failed `DEPOSIT_NOT_ELIGIBLE` because the booking's slot
  hold had expired. Both timeline approvals remained intact. An owner-authorized,
  guarded repair used the canonical hold repository and assigned manager, checked
  for another booking's hold and active/settled deposits, and wrote a SYSTEM audit.
  No settlement, contract, approval or other booking was overwritten.
- A new deposit attempt `083838d6-6498-44a3-a441-c758d7ce3265` was created through
  the deployed website. VNPay confirmed success. At 19:21:26 UTC on 22 October,
  a fresh signed QueryDr response was passed to the canonical reconciliation service
  in the same operator run, after respecting the provider's five-minute cooldown.
  Accepted evidence hash:
  `d0e88b772be5f93c390888d7504079e2812682a318e3f7ef7591388980e24adf`.
- Read-only verification found SUCCEEDED, exactly one PAYMENT entry of 21,000,000
  VND and one deposit application. Booking became CONFIRMED at revision 10; the
  authenticated website showed full billing access and 49,000,000 VND outstanding.

This was a provider-verified operator recovery, not an automatic cloud-query proof.
Database access was limited temporarily to the workstation IPv4 and restored to an
empty public allowlist in `finally`; TLS peer verification remained enabled.

## Balance checkout and authentic IPN

The deployed website calculated 49,000,000 VND and created BALANCE attempt
`0e826112-b493-4c5b-8e3b-d6fd6772ba93`. Browser steps selected domestic card/account,
NCB, the owner's test card and its issue date. The supplied five-digit OTP failed;
VNPay's [official test-card documentation](https://sandbox.vnpayment.vn/apis/vnpay-demo/)
specifies six-digit OTP `123456`, which completed this sandbox checkout.

At 19:24:15 UTC, the backend retained authentic accepted **IPN** success evidence,
hash `229d5ea1b5d91e051735760c83aeb485f6a0a08f15672a16d1e536fe11424e16`.
Read-only verification found exactly one balance PAYMENT of 49,000,000 VND, no
balance deposit application, and total PAYMENT 70,000,000 VND against CHARGE
70,000,000 VND. No operator reconciliation was used for this balance settlement.

After a fresh website login, the UI showed both payment entries, zero outstanding
and completed application. Explicit status checks returned HTTP 200, `no-store`,
SUCCEEDED/application SUCCEEDED. Reloading and rechecking did not create another
payment: the final read at 19:28:13 UTC retained one balance entry and 70,000,000
VND total. Desktop 1440px and mobile 390px Vietnamese rendering was inspected;
mobile had no horizontal page overflow.

The separate Orchid test booking was inspected but rejected new deposit creation
as ineligible. No eligibility repair or new payment was made for that booking.
The checkout return tab required login; it did not infer settlement from URL data.

## Release and limits

- Backend main `f068aa8a72877dcb8a9cc4e117ffa073b652ec71`, Render deployment
  `dep-dbd5nbe7bikc73f73pjg` is live. [Main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39833879785)
  passed, including 313 files / 2,342 tests and 713 integration tests.
- Frontend main `25e72fe6f45776f119eb70c6a2efddef0d1eb66b` is deployed at
  [the website](https://wedding-web-silk.vercel.app).
  [CI and deployment](https://github.com/WDP301-wedding/wedding-web/actions/runs/39838983919)
  passed all gates, including 46 files / 344 tests and production build.
- OpenAPI hash `ae7f0a389df05021305a7bf4f9467fc17c77518584b482bec8b26cba055d3b18`
  matches the deployed backend. Additive migration `20261023013000_vnpay_query_lease`
  is applied; environment variables remain unchanged. No applied migration changed.
- Reviewed dev-only braces audit exception remains approved through 29 October;
  production audit is clear. Other audit gates remain enforced.
- IPN settlement is now proven live. The first web query relay timed out; the
  follow-up pins Vercel to `sin1` and exposes safe failure stages. Its authenticated
  terminal-status path is verified, but a nonterminal provider round trip from
  this final deployed runtime has **not** been proven. Keep this follow-up open;
  do not present the operator query as automatic cloud recovery.
- Timeout/unverified evidence continues to retain UNKNOWN. Expiry alone cannot
  authorize a retry. Render's automatic checksPass deploy hook is also unproven;
  this backend release used an explicit deployment of the checked commit.

Rollback may restore backend `5a102e4814be3399cdf8031bfce62f3c57e6e0e8` and frontend
`47b9558940fae6fab05a32c82a5bd4a9089dce8f` if necessary. Preserve the additive lease
table, immutable payment evidence and the working Render merchant IPN configuration.
Rollback does not reverse sandbox settlement history.
