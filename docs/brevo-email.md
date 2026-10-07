# Brevo transactional email

The backend uses Brevo's HTTP API for password reset emails and the shared workspace invitation notification port. Startup does not send an email. A blank email configuration uses the offline fake in development/test; staging and production require real email configuration.

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
```

The sender address must match the sender verified in Brevo. Both Brevo values must be supplied together. Only one provider may be configured at a time; clear both Resend values when using Brevo. All four values may be blank for offline development/test. Never put these credentials in frontend variables, `.env.example`, or Git.

Restart the backend after changing `.env`:

```powershell
npm run dev
```

## Check delivery

With PostgreSQL configured and an existing eligible account, request a password reset using the application's forgot-password flow. Inspect **Transactional > Email > Logs** in Brevo, and check the recipient's inbox and spam folder. Unknown accounts do not receive a reset email. A successful API response means Brevo accepted the message; final delivery is reported by Brevo's logs.

If sending fails, check the API key, verified sender, transactional account activation, remaining sending quota, and any IP authorization request from Brevo. The backend deliberately returns sanitized provider errors rather than exposing email addresses, reset links, raw provider messages, or keys.

## Adapter behavior

- Sends to `POST https://api.brevo.com/v3/smtp/email` using the `api-key` HTTP header, a parsed sender, recipients, subject, text, and optional HTML. See [API reference](https://developers.brevo.com/reference/sendtransacemail).
- Validates commands and response message IDs, rejects redirects, and aborts requests after 10 seconds, including response body reading. HTTP 429/5xx and transport errors map to provider unavailability; other rejected requests map to a generic provider error. There are no automatic retries.
- Converts the full persisted event/entity intent into a deterministic UUID v5 for Brevo's `headers.idempotencyKey`, preserving the same key across restarts and separating different intent types. Brevo documents a **30-minute** deduplication window and a `duplicate_parameter` rejection for reused keys. A rejected duplicate is a provider error, not a replay of the original success. This does not replace durable application delivery/audit state. See [Brevo idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).
- Retains Resend for existing environments configured with only `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

Tests use controlled HTTP doubles; they do not send real email:

```powershell
npm test -- src/integrations/email src/config/env.test.ts
```
