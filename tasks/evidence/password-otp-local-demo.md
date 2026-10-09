# Password email OTP and local demo evidence

Validated on 2026-10-08 against the dedicated local PostgreSQL database.

## Behavior

- Both password recovery and authenticated password changes require a six-digit Brevo email OTP. Changes also verify the current password and bind the challenge to the requesting session.
- Codes expire after ten minutes, allow five incorrect attempts, and are stored only as keyed digests. Resending revokes the preceding challenge. Successful completion revokes every session and credential for the account.
- Previous reset-link endpoints return `410 PASSWORD_OTP_REQUIRED`; direct password changes without an OTP are rejected.
- Web, management web, and the native app implement request, confirmation, resend cooldown, and login after completion.

## Local fixture

- All 17 migrations applied to `127.0.0.1:55435/wedding_local_demo`; the existing application database was not modified.
- Two accounts, two halls, a small catalog, two consultation/bookings, one mutually approved booking timeline, one deposit settlement fixture, and one consultation intake. No data for later specifications.
- Setup was run twice successfully to verify repeatability. Generated initial passwords and database secrets remain in ignored `.env.demo`.
- Real Manager and Couple login succeeded. Browser checks verified Couple overview/workspace/profile and Manager login.
- With the user-authorized Brevo IP, the reset request and authenticated change request both returned HTTP 202. Brevo activity subsequently reported `delivered` for both approved demo recipients at 23:42 local time. Sending tests did not change the demo passwords.

## Checks

- Backend regression: 821 tests across 83 suites passed.
- OTP, account settings, runtime/custom schema, and retention integration: 20 tests across four suites passed using disposable local databases.
- Public web: 56 tests; management web: 93 tests; native app: 33 tests passed.
- Backend build/typecheck, both Next production builds, native typecheck, and lint for all four repositories passed.
- Backend OpenAPI verification passed; clients regenerate from the pinned published contract.

See [local demo instructions](../../docs/local-demo.md) for start/stop commands and browser cookie guidance.
