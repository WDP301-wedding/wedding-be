# Staff email invitation verification — 2026-11-09

Scope: [owner-approved flow](../../docs/staff-email-invitations-2026-11-09.md).

## Local evidence

- Additive migration applied with all 88 immutable migrations to disposable
  PostgreSQL databases using the existing 127.0.0.1:55435 test administrator.
- Staff invitation + existing Staff operations/workspace: 25 tests passed.
- Staff invitation + password OTP + Identity runtime: 17 tests passed. One first
  run exceeded the legacy OTP suite's 10-second cleanup timeout after all tests
  passed; rerun with hookTimeout=60000 passed, without changing source test gates.
- Config/token/identity-email and API/CI contracts: 237 tests passed (the additional
  Manager-origin validation case was added afterward and is covered by release CI).
- Manager Web full suite: 61 files / 347 tests passed. Follow-up identity reset,
  app smoke and invitation tests: 16 passed after the navigation-fragment fix.
- Manager Web focused new gateway/page, personnel and typography: 25 tests passed.
- Backend typecheck/lint/OpenAPI and build passed. Manager Web typecheck/lint and
  production build passed with the real public HTTPS API/realtime origins.
  The initial production build correctly rejected development HTTP values from
  local .env.local; no validation policy was relaxed.
- Chromium desktop 1440px and narrow mobile 320px: invitation renders without
  horizontal overflow, Vietnamese glyphs inspected, mismatched confirmation is
  blocked, token fragment removed, initial password accepted, login prefilled,
  STAFF login and assigned-event page accessible, zero page errors. Screenshots
  and synthetic email capture remain in ignored .local-demo files.

The UI browser check found a module-initialization history rewrite stripping the
login query during client navigation. Identity now consumes a reset fragment only
when a fragment exists; the same complete browser journey passed afterward.

## Authorized live account cleanup

The owner confirmed Render workspace "my space" for deleting the named unused
Staff test identity. Read-only inspection showed ACTIVE / STAFF only, no password,
assignments or work items. Under one transaction the account was locked, roles
and UUID/text account/actor references were rechecked, an audit record appended,
and only that Staff role and account deleted. Verification: deleted=1, remaining=0.
Prior audit history was preserved. No agreement, payment, event or provider email
was removed or replayed.

The hosted Render SQL tool could not connect because external database access is
blocked. Cleanup used the existing service's SSH access and internal connection;
no IP allowlist, database credential, network policy or infrastructure was changed.

## Release boundary

Controlled email tests and local browser success do not prove real mailbox
delivery. No invitation was sent to the owner's email during these checks.
Record the actual backend/client release and deployed checks before claiming the
new flow available on Render/Manager Web. Keep tokens and provider receipts private.
