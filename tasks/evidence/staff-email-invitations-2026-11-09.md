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
The owner will exercise real mailbox delivery by recreating the unused account.
Keep tokens and provider receipts private.

## Verified deployed release

- Backend [PR 117](https://github.com/WDP301-wedding/wedding-be/pull/117), merged
  commit `1149479a25b883c85ee0c50505e5de6648e66297`; final PR CI and exact main
  [CI run](https://github.com/WDP301-wedding/wedding-be/actions/runs/42637092399)
  passed all lint, production/unit/contract/audit and native PostgreSQL gates.
  The runtime fixture follow-up replaced an incomplete Config cast with the real
  environment parser; 131 focused config/composition tests passed locally.
- Render deploy `dep-dbotpo95efls73f02m0g` became LIVE on 2026-11-09 at
  21:49 Asia/Saigon, on that exact backend commit. MANAGE_WEB_ORIGIN was patched
  by key, preserving other service variables; the same public value is in
  render.yaml. The current published Render JSON Schema validated the YAML.
- Manager [PR 57](https://github.com/WDP301-wedding/wedding-manage-web/pull/57),
  merged commit `aba4bd4ff90c880313c02ce3220ecacc2a6c529d`; final PR and exact main
  [CI/deploy run](https://github.com/WDP301-wedding/wedding-manage-web/actions/runs/42636489275)
  passed. The live page is
  [Manager Web Staff invitation](https://wedding-manage-web.vercel.app/staff-invitation).
  A separate dependency commit patched the existing audit blockers; final audit
  reported zero high/critical findings without weakening its policy. The full
  desktop/320px mobile setup-to-Staff-login journey passed again on Next 16.4.5.
- Live checks: readiness 200; a nonexistent, syntactically valid Staff token
  returns 422 STAFF_INVITATION_INVALID_OR_EXPIRED and Cache-Control no-store.
  Actual Manager Web reaches the new API, removes the URL fragment, displays the
  invalid-link state at 320px without horizontal overflow, and has zero page errors.
- Internal post-deploy read-only evidence confirmed the migration completed,
  Manager origin is correct, email configuration exists, and the owner-named test
  email still has zero Account rows. This is configuration/runtime evidence,
  not a claim that an email reached an inbox.
