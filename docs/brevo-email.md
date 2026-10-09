# Brevo transactional email

The backend uses Brevo's HTTP API for email OTPs when changing or resetting a password, and for workspace invitations. Startup does not send an email. Password OTP endpoints fail with `EMAIL_NOT_CONFIGURED` when email is disabled; they never return a fake success. Other offline integrations can still use their development/test fakes.

## Account setup

1. Register at [Brevo](https://www.brevo.com/) and complete the requested account checks. Ensure transactional email sending is enabled for the account.
2. Open **Settings > SMTP & API > API Keys & MCP** ([API keys](https://app.brevo.com/settings/keys/api)). Generate an API key named `wedding-be-local` and save it immediately. Use an **API key**, not an SMTP key or MCP-specific key. See [API key authentication](https://developers.brevo.com/docs/api-key-authentication).
3. Open **Settings > Senders, Domains, IPs > Senders**, then **Add a sender**. Enter the name `Wedding Restaurant` and an email address you control. If the domain is not authenticated, confirm the verification code sent to that mailbox. See [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).
4. Without a custom domain, a verified free email address can be used during setup. Brevo replaces free sender addresses with an address under its own sending domain, including transactional messages; recipients may therefore see a different From address. Brevo describes this as a temporary measure and recommends an authenticated custom domain for long-term use. See [sender address replacement](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

## Backend configuration

Edit `wedding-be/.env` locally; the following values are examples, not working credentials:

```dotenv
BREVO_API_KEY=replace-with-your-api-key
BREVO_FROM_EMAIL="Wedding Restaurant <your-project-email@gmail.com>"

RESEND_API_KEY=
RESEND_FROM_EMAIL=

# Generate an independent secret of at least 32 bytes, keep it stable across restarts.
AUTH_OTP_HASH_KEY=replace-with-random-32-byte-secret
```

The sender address must match the sender verified in Brevo. Both Brevo values must be supplied together. Only one provider may be configured at a time; clear both Resend values when using Brevo. All four values may be blank for offline development/test. Never put these credentials in frontend variables, `.env.example`, or Git.

Restart the backend after changing `.env`:

```powershell
npm run dev
```

## Check delivery

With PostgreSQL configured and an existing eligible account, request a password reset using the application's forgot-password flow. Inspect **Transactional > Email > Logs** in Brevo, and check the recipient's inbox and spam folder. Unknown accounts do not receive a reset email. A successful API response means Brevo accepted the message; final delivery is reported by Brevo's logs.

If sending fails, check the API key, verified sender, transactional account activation, remaining sending quota, and any IP authorization request from Brevo. The backend returns sanitized errors and revokes undelivered challenges.

## Password confirmation

- Forgot password: `POST /auth/password-otp-requests` with `email`, then `POST /auth/password-otp-completions` with `challengeId`, `code`, and `newPassword`.
- Change password: authenticated `POST /auth/password-change-otp-requests` with `currentPassword`, then authenticated `POST /auth/password-changes` with `challengeId`, `code`, and `newPassword`.
- Codes contain six digits, expire after 10 minutes, allow five incorrect attempts, and are consumed atomically once. Resending revokes the previous code; cooldown is 60 seconds and requests are limited to three per subject per hour. Failed attempts persist in PostgreSQL.
- The database stores a keyed HMAC digest, never the plaintext code. Change challenges bind to the original account/session and current password credential. Successful changes/reset revoke every session and credential, and require login again.
- Existing link-based request/completion endpoints return `410 PASSWORD_OTP_REQUIRED` in the runtime. Old reset links must request a new OTP; invitation links are unaffected.
- `AUTH_OTP_HASH_KEY` is required outside development/test. Local demo setup creates a stable secret in ignored `.env.demo`. Development without it uses a temporary key, so restarting invalidates pending codes.
- The service assumes the existing single-replica deployment contract for IP/subject rate limits. Do not increase replica count without a shared throttle store.
- Identity retention deletes expired OTP metadata after 30 days; account anonymization revokes pending OTPs.

## Adapter behavior

- Sends to `POST https://api.brevo.com/v3/smtp/email` using the `api-key` HTTP header, a parsed sender, recipients, subject, text, and optional HTML. See [API reference](https://developers.brevo.com/reference/sendtransacemail).
- Validates commands and response message IDs, rejects redirects, and aborts requests after 10 seconds, including response body reading. HTTP 429/5xx and transport errors map to provider unavailability; other rejected requests map to a generic provider error. There are no automatic retries.
- Converts the full persisted event/entity intent into a deterministic UUID v5 for Brevo's `headers.idempotencyKey`, preserving the same key across restarts and separating different intent types. Brevo documents a **30-minute** deduplication window and a `duplicate_parameter` rejection for reused keys. A rejected duplicate is a provider error, not a replay of the original success. This does not replace durable application delivery/audit state. See [Brevo idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).
- Retains Resend for existing environments configured with only `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

Tests use controlled HTTP doubles; they do not send real email:

```powershell
npm test -- src/integrations/email src/config/env.test.ts
```
