# Local demo: SPEC-01 to SPEC-03

The dedicated PostgreSQL database is `wedding_local_demo` on `127.0.0.1:55435`. Setup creates its own cluster in ignored `.local-demo/postgres`, uses SCRAM password authentication over localhost, applies the current schema, and inserts a small fixture. The existing `.env` database is never migrated or seeded by these commands.

## Start

In `wedding-be`:

```powershell
npm run demo:setup
npm run demo:dev
```

In two additional terminals:

```powershell
# wedding-web
npm run dev -- --port 3000

# wedding-manage-web
npm run dev -- --port 3002
```

Both frontend `.env.local` files must use `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1`. Android on an emulator uses `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3001/api/v1`; use a reachable LAN backend URL on a physical device.

Public website: `http://localhost:3000`. Couple login/profile: `/account`, overview: `/overview`, consultation form: `/consultation`. Management login/consultation queue: `http://localhost:3002`.

Use separate browser profiles or an incognito window to demonstrate Manager and Couple simultaneously: both local web origins share the backend's host cookie.

## Accounts and data

Setup saves Manager/Couple emails and initial generated passwords in ignored `.env.demo` (`DEMO_MANAGER_EMAIL`, `DEMO_MANAGER_PASSWORD`, `DEMO_COUPLE_EMAIL`, `DEMO_COUPLE_PASSWORD`). Passwords are hashed with the normal application policy in PostgreSQL. Do not publish this file. The setup is repeatable and preserves edits and changed passwords; it never resets an existing account password.

Rerunning `demo:setup` reuses the complete catalog even after Manager edits increase the restaurant revision or change its display name. It still refuses a catalog with a different restaurant ID or missing seed records. The separate `catalog:seed` command retains its strict conflict checks.

To choose other recipient emails before the first setup, set `DEMO_MANAGER_EMAIL` and `DEMO_COUPLE_EMAIL` in the terminal. With an existing setup, change account emails explicitly in the database as well as `.env.demo`. Default aliases are derived from a Gmail sender configured in `.env`, so both aliases reach that mailbox. Otherwise setup uses `.example` addresses that need replacing before email delivery can be demonstrated.

The fixture contains two accounts, two halls with two shifts, a small dish/menu catalog, catalog timeline/layout templates, two consultations/bookings (one confirmed with a mutually approved timeline and one restricted draft), a SPEC-03 deposit settlement fixture, and one new consultation intake. Event dates are relative to setup time. No guest, invitation-printing, seating, notification-center, or later-SPEC dataset is inserted. The full current schema is needed for the running application, including the additive profile/intake/OTP migrations. New commercial/profile/final-invoice requirements are pending extensions; the existing fixture does not prove them.

The deposit record is local demo evidence, not a real payment or provider integration. No email is sent by setup. OTP emails are sent only when a user requests them. Brevo settings are inherited from `.env`; OTP hashing and database settings come from `.env.demo`.

If OTP delivery fails even with Brevo configured, check **Settings > Security > Authorized IPs** in Brevo. When IP blocking is enabled, the backend's current public IP must be authorized; a network change can cause Brevo to reject API calls with HTTP 401. Authorize the current trusted IP, then request a new OTP after the resend cooldown. The initial demo emails in `.env.demo` must also match the account's actual recipient email.

OTP requests have a 60-second resend cooldown and a limit of three requests per account/purpose per hour. HTTP 429 includes `Retry-After` in seconds; the account page shows the wait and disables sending until it ends. Rapid retries rejected during the cooldown do not consume the hourly quota. After editing backend code or `.env`, restart `demo:dev` to load the changes.

## Demonstrate

1. Open the public halls/menus and submit a consultation request.
2. Sign in as Manager and inspect/convert the intake request.
3. Sign in as Couple and open the confirmed booking and approved timeline. The draft proposal is also visible on web; Android shows only the confirmed full-access plan.
4. Update the profile. Choose **Gửi mã OTP**, read the newest code in the mailbox, and confirm a new password. Login is required again everywhere.
5. Choose **Quên mật khẩu?**, request a code, enter it with a new password, and login again. Check spam or Brevo transactional logs if needed.

Database data persists after stopping the backend. Stop/start only this database using `npm run demo:db:stop` and `npm run demo:db:start`. If PostgreSQL is installed elsewhere, set `POSTGRES_BIN` to its `bin` directory. A demo password changed through the UI replaces the initial password; `.env.demo` remains a record of the initial fixture credentials.
