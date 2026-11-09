# Staff invitations — 2026-11-09

The owner requested email invitations and a Manager Web password-setup page,
then approved implementation across wedding-be and wedding-manage-web. This
extends assigned-event operations; Couple invitations and financial history keep
their existing contracts.

## Flow and identity

Manager `POST /api/v1/management/staff-accounts` with `{ "email": "staff@example.test" }`
and a durable Idempotency-Key creates/reuses the normalized identity and issues a
Staff invitation. New/restored STAFF authority is granted on acceptance. Existing
Staff retains current authority. Manager may preassign a valid pending invitee;
the invitee cannot operate as Staff until acceptance. No Couple role, consultation
access or password is replaced.

The email links to `${MANAGE_WEB_ORIGIN}/staff-invitation#<opaque-token>`.
Manager Web removes the fragment immediately and holds the token in memory only.
Public POST endpoints accept the token in JSON, never in a URL or query:

- `/auth/staff-invitation-details`: `{ invitationToken }` returns maskedEmail,
  hasExistingPassword and expiresAt without consuming the invitation.
- `/auth/staff-invitation-acceptances`: `{ invitationToken, password }` initializes
  a missing password, or verifies an existing password unchanged. It returns
  accepted/email/requiresLogin, without issuing a session. The success page links
  to Manager Web login with the email prefilled.

Both endpoints reject extra fields, are no-store/no-referrer, and share a
10-request / 15-minute IP limiter (Redis when configured). STAFF alone is granted;
Manager accounts cannot be invited. Invalid, expired, superseded, revoked,
consumed links and incorrect existing passwords return the same 422
STAFF_INVITATION_INVALID_OR_EXPIRED. Password writes follow existing policy.

## Reissue, delivery and revocation

Links use 32 random bytes, purpose-separated hashes, a 72-hour lifetime and atomic
single consumption under the account lock. Only hashes enter the database;
neither tokens nor passwords enter audit or command results. Opening a link does
not accept it (email link scanners cannot consume it).

The same Manager endpoint explicitly reissues a link with a new Idempotency-Key.
An identical command replay never sends a second email. Reissue supersedes the
old token; a 60-second cooldown and maximum three invitations per account per
24 hours prevent accidental repeated sends. Directory invitation state is
PENDING/ACCEPTED/EXPIRED/REVOKED, separately from credentialSetupRequired and event
assignment.

Delivery intent is committed before sending. ACCEPTED means the provider accepted
the send, not delivery to the inbox. Explicit HTTP rejection records FAILED;
timeouts, ambiguous errors or process failure retain UNKNOWN. A Manager checks
the mailbox/provider and explicitly reissues; there is no automatic resend after
an ambiguous external effect. No plaintext token is retained for worker replay.

Disabling operational access atomically revokes active invitations, STAFF,
sessions and active event assignments. Other account roles/access remain.
`enabled:true` is rejected with STAFF_INVITATION_REQUIRED; restore through a new
invitation. Historical agreements and payments remain untouched.

## Configuration and migration

Apply the additive `20261109070000_staff_email_invitations` migration before the
new backend. Configure the existing email provider plus MANAGE_WEB_ORIGIN to the
actual Manager Web HTTPS origin (loopback HTTP permitted locally). Missing
configuration fails STAFF_INVITATION_NOT_CONFIGURED without committing an account.
No automatic invitations/backfill are sent to legacy accounts. Manager can use
the directory's Send invitation action for accounts without a password.

Publish backend and Manager Web together. Keep the migration on application
rollback; do not rewrite migrations, account passwords, contracts or payments.
Existing generated Manager OpenAPI release pins remain unchanged until a real
backend release is available; new DTO fields/endpoints are runtime validated.

## Verification

The focused native PostgreSQL suite covers first setup, existing Couple password
preservation, preassignment without premature authority, replay, resend, expiry,
disable, direct-enable denial, explicit/ambiguous email failures and public HTTP
validation/rate limiting. Manager tests cover password confirmation, existing
password acceptance, invalid links, retry after fragment removal and Vietnamese
typography. These checks use isolated local data and controlled email; they are
not evidence of real mailbox delivery.
