# Production identity email destinations — 2026-11-04

The owner reported a localhost invitation email while provisioning Staff, then
confirmed that the screenshot was an old email (9 October). Current Staff
provisioning grants the operational role and reports whether password setup is
needed; it does not send workspace-invitation mail. New Staff use the management
website's existing password OTP flow. This fix does not add an automatic email,
change roles or send messages to real recipients.

## Root cause and correction

Booking's invitation composition selected `CORS_ALLOWED_ORIGINS[0]` as the email
destination. The failing regression captured a real notification command containing
`http://localhost:3000/workspace-invitation#...` even with an explicit public
website configured. The email provider is controlled; the token is synthetic.

Staging/production now use `PUBLIC_INVITATION_WEB_ORIGIN` exclusively and reject a
missing value, plain HTTP or a loopback target. Development/test retain their local
CORS/default fallback. Production already declares the correct website in
`render.yaml`; `.env.example` and the Identity operations guide now document it.
The credential remains in the fragment and retains the existing provider intent
key. CORS authorization, invitation expiry/reissue/consumption and Staff provisioning
are unchanged. No database migration or API shape change is needed.

## Checks

- Local config and identity-email subset: 133 tests passed, including eight
  new destination cases. The exact wrong-host regression failed before the fix.
- Public production destination checked without credentials: legacy
  `/workspace-invitation` returns 308 to `/loi-moi`, which returns 200 on
  `https://wedding-web-silk.vercel.app`.
- Staff password setup page `https://wedding-manage-web.vercel.app/reset-password`
  returns 200. No account or credential was created, consumed or reset.
- The native PostgreSQL Booking runtime composition case passes, including local
  fallback, configured email adapter construction and disconnect after rejected
  production configuration. The wider runtime file also has an existing deposit
  eligibility assertion failure; replaying that one case with the unmodified
  baseline runtime source reproduces it. It is outside this URL correction.
- Inverting the deployed-origin guard caused the regression tests to fail; the
  original source was restored. A test-only mock's branded idempotency key was
  corrected after typecheck exposed its invalid fixture type.
- Remaining static/release checks are recorded when complete below.

An already delivered message cannot be rewritten. These checks do not claim a new
real email delivery, inbox/spam placement or acceptance of a real invitation.
