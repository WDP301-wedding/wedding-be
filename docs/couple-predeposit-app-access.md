# Couple app access before deposit — 2026-10-23

Owner request: let Couple use the mobile app for the existing pre-deposit journey
and deposit checkout. Implementation scope is `wedding-be`; app UI and navigation
adoption remain with the app team. Historical SPEC/RV acceptance is preserved.

## Identity and authorization

`COUPLE` now identifies a customer workspace participant. Accepting a valid Manager
invitation grants it atomically with the access grant, session and token consumption.
New grants stay `RESTRICTED`, with no booking/payment/promotion evidence. Existing
account roles and existing `FULL` grants remain intact. Invitation issuance alone,
failed password verification and expired/replayed tokens do not grant a role.
Existing accounts still prove their current password; this adds no public signup.

Every API continues to check the authenticated account's grant on the addressed
consultation/booking. Global `COUPLE` does not authorize another Couple's resources
or prove a deposit on any booking, including an account with several weddings.
Suspended/disabled accounts remain blocked by the existing authentication policy.

| Action                                                            | Owning RESTRICTED Couple, Web or Android | Owning FULL Couple                        |
| ----------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Login, account settings, own booking overview                     | Allowed                                  | Allowed                                   |
| Read/update separate bride/groom profile                          | Existing rules                           | Existing rules                            |
| Proposal, timeline edit/approve/withdraw                          | Existing phase/revision rules            | Existing phase/revision rules             |
| Commercial selections, submit/approve, read/download contract PDF | Existing commercial rules                | Existing immutable history/appendix rules |
| Start/reopen/read deposit attempt                                 | Allowed when server eligibility passes   | Existing rules                            |
| Balance checkout and ledger                                       | Denied                                   | Existing invoice/balance rules            |
| Media, invitation editor/send/production, guests, seating         | Denied                                   | Existing feature/phase/client rules       |
| Manager/Staff actions                                             | No new authority                         | No new authority                          |

## API contract

All routes are relative to `/api/v1`. Existing strict schemas and error envelopes
remain authoritative in `openapi/openapi.json`; its matching SHA-256 is in
`openapi/openapi.sha256`.

New public `POST /auth/android-workspace-invitation-acceptances`:

```json
{
  "invitationToken": "wii_<43 URL-safe characters>",
  "password": "a-password-of-at-least-12-characters"
}
```

Uses the existing `invitationAcceptanceBodySchema` and `IssuedSessionResponse`.
Status `201` returns `data.account` with `roles` containing `COUPLE`, `sessionId`,
`clientKind: "ANDROID"`, `accessToken`, `accessExpiresAt`, `refreshToken`,
`refreshExpiresAt` and `absoluteExpiresAt`. Both credentials are returned in the
body; no Web refresh cookie is set. Response is `Cache-Control: no-store`.

The existing `POST /workspace-invitation-acceptances` remains Web-only, with the
refresh credential solely in its secure HttpOnly cookie. The two endpoints consume
the same one-time invitation. Clients cannot select roles, access level or transport
in the body. Tokens never belong in URL parameters.

Invalid/expired/consumed invitation or incorrect existing password returns
`401 INVALID_OR_EXPIRED_TOKEN`; invalid bodies or password policy return
`422 VALIDATION_ERROR`; the shared invitation IP/token throttle returns
`429 RATE_LIMITED`. After an unknown acceptance outcome, use normal login instead
of automatically replaying acceptance. Existing users can directly log in at
`POST /auth/android-sessions`; refresh uses `/auth/android-session-refreshes`.

`GET /couple/bookings?client=ANDROID&limit=20` now has the same scope as Web:
owned `RESTRICTED` and `FULL` grants, all existing booking phases including `DRAFT`,
`AWAITING_DEPOSIT`, `CONFIRMED`, `COMPLETED` and `CANCELLED`. `client` remains an
optional compatibility hint (`WEB` default), never an authorization input.
The strict response shape is unchanged, for example:

```json
{
  "data": [
    {
      "bookingId": "11111111-1111-4111-8111-111111111111",
      "consultationId": "22222222-2222-4222-8222-222222222222",
      "eventDate": "2027-02-01",
      "phase": "AWAITING_DEPOSIT",
      "accessLevel": "RESTRICTED",
      "hallName": "Sảnh sen",
      "shiftCode": "DINNER",
      "planningHeadcount": 100,
      "managerApproved": true,
      "coupleApproved": false,
      "hasTimeline": true
    }
  ],
  "nextCursor": null
}
```

The descending event-date/ID ordering, UUID cursor, 1–50 limit and private no-store
response remain unchanged. No grants or no booking yet returns an empty list.
Manager still creates consultations/proposals and sends invitations.

Use the existing bearer APIs from Android for the remaining journey:

- `GET/PATCH /consultations/{consultationId}/couple-profile`.
- `GET /bookings/{bookingId}/proposal` and existing timeline revision,
  approval/withdrawal commands.
- Existing `/bookings/{bookingId}/contracts` reads, draft/submission/approval,
  withdrawal and `/{revisionId}/pdf` routes.
- `POST /bookings/{bookingId}/payments/deposit` with exact timeline revision,
  commercial revision and document digest; use a stable `Idempotency-Key` for retries.
- Existing unresolved-attempt discovery, checkout reopen and deposit status routes.

Amounts remain server-calculated integer VND. The current full-contract model
requires complete separate names, mutual approvals of the exact commercial and
timeline revisions and a valid slot reservation; deposit is
`ceil(contractTotalVnd * 30 / 100)`. Contract/payment writes retain existing
revision conflicts, immutable documents, idempotency and UNKNOWN protections.
Opening/returning from checkout never grants `FULL`; verified settlement does.
The VNPay protocol remains `2.1.0` using the existing sandbox adapter and
configured return/IPN routes. This revision changes no provider or payment protocol.

## Migration and rollout

Deploy the new forward migration
`20261023020000_couple_predeposit_app_access` with the matching backend. It inserts
one `COUPLE` role per existing `ConsultationAccess.accountId`, using the unique
account/role constraint to preserve existing rows and make reapplication harmless.
It does not change grants, payment evidence, account status or sessions and requires
no Prisma schema/type regeneration. Applied migrations are unchanged.

Coordinate activation with consumer gate updates: the current app planning adapter
rejects RESTRICTED, while `wedding-web/src/features/identity-access/session.ts`
labels any COUPLE account as full. The backend continues to enforce real grants,
but these clients must consume the new role meaning for a correct user experience.

Apply through the normal authorized `npm run db:migrate:deploy` release process.
Existing users do not need another invitation or a password reset. Their next
login or `/auth/me` sees the role. Roll back application code only if required;
retain the additive roles and all financial history. Restoring the old mobile-only
booking filter would hide pre-deposit bookings again.

## App team adoption

Allow `COUPLE` to enter the app independently of payment. Use each booking's
`accessLevel`, `phase` and existing capability fields to display allowed actions.
The account role is shared across clients: Web consumers must also use the
booking grant for post-deposit gates rather than inferring payment from `COUPLE`.
Remove the client-side FULL-only guard in the planning/proposal adapter for the
pre-deposit screens; do not send a fake `FULL` level. Support empty booking state
and consultations awaiting Manager proposal creation. Show cancelled/completed
history according to its actual phase.

Use the native acceptance endpoint for first-use invitation deep links and store
only the refresh credential in secure device storage. Render the existing contract,
timeline, catalog selection and deposit screens; reopen checkout in the provider
browser and poll the authenticated payment status when returning to the app.
Provider return routing and live sandbox acceptance need the app team's separate
integration verification. This backend revision does not edit `wedding-app`.

## Evidence boundaries

Local verification is recorded in
[the implementation evidence](../tasks/evidence/couple-predeposit-app-access-2026-10-23.md).
Native HTTP/database tests and controlled VNPay fixtures do not prove real email
delivery, hosted Android UI, gateway transactions or deployment readiness. No paid
generation or real-money payment is authorized here. The owner subsequently
authorized deploying this backend and its additive migration to the existing
server on 2026-10-23; release evidence is recorded separately from local tests.
