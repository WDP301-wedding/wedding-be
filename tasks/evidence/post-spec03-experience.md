# Post-SPEC-03 experience — implementation evidence

Date: 2026-10-08. Implementation owner: Codex, sequential work across four repositories.
Scope authority: the project owner's request to implement the approved post-SPEC-03
additions. Contract: [SPEC-post-booking-experience.md](../../SPEC-post-booking-experience.md).

## Delivered

- wedding-web: public landing, published halls/detail, menus and per-table VND prices,
  restaurant contacts, and consultation form with retained drafts and stable retry ids.
  Routes: `/`, `/halls`, `/halls/{id}`, `/menus`, `/consultation`.
- booking-lifecycle: public intake acknowledgement, Manager queue, atomic conversion
  into one consultation, closure, and continuation into existing booking/invitation
  commands. Concurrent conversions create one consultation. Audit contains ids only.
- Couple Web/App: own-booking overview and navigation to proposals/timelines. Android
  query requires FULL consultation access and CONFIRMED/COMPLETED phases. Web booking
  links automatically load through the authenticated gateway; arbitrary invalid ids
  are not loaded automatically. No future module has an active control.
- identity-access: own display-name profile with revision checks, current-password
  verification and atomic password/session/reset-credential replacement/revocation,
  local cleanup after revocation, and existing forgot/reset flows. Issued raw credential
  fragments and named fragments both work. Email and roles remain read-only.
- Persistence: additive migration `20261008008000_post_booking_experience`; nullable
  profile name/revision and consultation intake. Account erasure includes profile name.
  Intake retention deletes unconverted requests or scrubs converted contacts after 180 days.

Provider ownership stays with venue-catalog for discovery, booking-lifecycle for intake
and overview, and identity-access for profile/password. Notifications remain SPEC-09;
print-file output remains the approved follow-up after SPEC-05.

## Verification

| Repository | Evidence |
| --- | --- |
| Backend | 821 unit/HTTP/contract tests passed; 6 new PostgreSQL integration scenarios passed. Lint, typecheck, build and OpenAPI checks passed. |
| Public Web | 54 tests passed; lint/typecheck/build/API check passed. Focused identity regression checks rerun after local cleanup change. |
| Management Web | 91 tests passed; lint/typecheck/build/API check passed, including new queue routes. |
| Android | 33 screen/API/session tests passed across four suites; lint/typecheck/API check and Android export passed. |

New PostgreSQL scenarios cover duplicate submissions and altered reuse, simultaneous
conversion, profile revision conflict, wrong/current password and session revocation,
cross-account/Web/Android overview scope, and idempotent retention. All 16 migrations
were applied to empty disposable PostgreSQL databases. Tests never targeted shared Supabase.
An upgrade database also applied the 15 prior migrations, retained an existing account,
then applied the new migration; its profile revision defaulted to 1 and name to null.

All clients pin the published OpenAPI artifact at backend commit
`2653728` with SHA-256 `9fd33a1a62ff1a5a270e3cf32a1bfe38c79468053057f9935818d782d5bd312f`.

Browser proof used real API/identity services on localhost and a separate seeded database,
with email/storage providers disabled. Verified public submit -> acknowledgement ->
Manager queue -> conversion -> prefilled consultation continuation; Couple login ->
profile save -> own overview -> automatic proposal load; wrong-password state and
successful password change -> login-required state. Desktop 1440px and mobile 390px
were inspected. Fixed HTML pattern escaping discovered in Chromium. Expected HTTP
401/422 responses during anonymous restore and incorrect-password testing are separate
from JavaScript errors.

Local screenshots are in ignored `test-results/post03/`: `landing-desktop.png`,
`consultation-mobile.png`, and `overview-mobile.png`. Catalog seed has no media;
the UI renders its missing-media state and uses uploaded published media when present.

## Operator hand-off and remaining runtime checks

- The shared/deployed database has not been migrated. Before running this version there,
  verify the configured migration target and run `npm run db:migrate:deploy`, then
  `npm run db:generate`. Deploy API before the clients that consume its new contracts.
- Intake retention uses `npm run retention:consultation -- --confirm-retention` against
  the verified target. Each run handles at most 100 records; repeat until deleted and
  scrubbed counts are zero. Logs contain counts only. Schedule through the deployment's
  existing maintenance process; no new automation was installed.
- No Android device was connected (`adb devices` returned an empty list). Native screen
  interaction is covered by tests and the Android bundle exports successfully; direct
  device/font/keyboard review remains a release runtime check.
- Configure real catalog copy/media and the existing email provider in the target
  environment. This local run does not prove external email delivery or production deployment.
- Project-owner visual acceptance and final release/device acceptance are still open;
  implementation is delivered without marking the later SPECs or release gate complete.
