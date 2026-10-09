# Post-SPEC-03 Product Experience

Status: Scope and implementation authorized by the project owner on 2026-10-08.
Sequence: after completed SPEC-03; notifications stay entirely in SPEC-09.
Baseline: WEDDING-CONTRACT-1@1.1.0; additive APIs only.

## Scope and decisions

- Public Website: Vietnamese landing page, published halls/detail, current menus and
  per-table VND prices, restaurant contacts, and consultation request form. Use actual
  SPEC-02 content; missing media/data have explicit empty/error states.
- Booking-owned intake: name, email, optional phone, preferred date, expected guests,
  and message. A stable client submission UUID and canonical payload hash make retries
  return the same acknowledgement and reject changed reuse. Requests are NEW until a
  Manager converts them atomically into one consultation or closes them. Public output
  contains acknowledgement only; no public list or personal-data lookup. Submission is
  rate limited; no account, invitation, slot hold, or booking is created automatically.
  Manager uses the existing booking and workspace-invitation commands after conversion.
- Couple overview: automatically list the actor's authorized bookings, display proposal,
  date/hall, current timeline approval, and next actions. Restricted Web users see their
  proposals/timeline; Android remains FULL-only and requires confirmed event access.
  Future payment, invitation, guest, and seating workflows have no active controls yet.
- Account settings: edit display name only (1–120 NFC characters), with expected profile
  revision. Email and roles are read-only. Password change verifies current password,
  uses existing 12–128/scrypt policy, atomically replaces the credential and revokes all
  sessions and reset credentials, then requires login again. Verify active session and
  credential revision at commit. Reuse existing forgot/reset-password endpoints and
  fragment handling. Do not store passwords/tokens in browser storage, audit, or logs.
- Additive persistence: nullable Account.displayName, profileRevision, and a request
  table with one unique conversion consultation. Retention: unconverted intake is purged
  after 180 days; converted intake contact fields are scrubbed after 180 days while the
  consultation follows its existing retention rules. Profile name follows account erasure.

## API and screens

| API                                                    | Consumer                          |
| ------------------------------------------------------ | --------------------------------- |
| POST /consultation-requests                            | Public consultation form          |
| GET /management/consultation-requests                  | Manager request queue             |
| POST /management/consultation-requests/{id}/conversion | Manager review -> consultation    |
| POST /management/consultation-requests/{id}/closure    | Manager close without conversion  |
| GET /couple/bookings                                   | Web/App overview; own grants only |
| GET/PATCH /auth/profile                                | Web/App account settings          |
| POST /auth/password-changes                            | Web/App password change           |

Web routes: /, /halls, /halls/{id}, /menus, /consultation, /account,
/overview, and existing /workspace. /account retains login/invitation/reset handling;
legacy root credential fragments remain usable. Management: /consultation-requests.
Android: existing home and planning plus account settings, using the existing native UI.

## Implementation waves and verification

1. Backend schemas/persistence, account security, intake/conversion, own-booking query;
   focused validation/authorization/retry/race tests and disposable PostgreSQL proof.
2. Deterministic OpenAPI and generated clients; public discovery/intake and Manager queue.
3. Couple Web/App overview and account settings; existing reset regression coverage.
4. Affected repository lint/typecheck/test/build/API checks, browser desktop/mobile
   inspection, Android export, retention verification, and evidence/checklist update.

Follow the approved wedding-design-system and preserve existing completed module history.
Use the normal serialized migration and OpenAPI publication lane. The owner's current
request authorizes these bounded waves without a second scope confirmation.
