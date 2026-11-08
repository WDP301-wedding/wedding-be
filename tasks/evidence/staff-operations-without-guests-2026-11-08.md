# Assigned-event operations verification — 2026-11-08

Scope: [owner-approved change](../../docs/staff-operations-without-guests-2026-11-08.md).
Source work covers wedding-be, wedding-manage-web, wedding-web and PRM-app on
`codex/staff-operations-without-guests`. No deployment or paid/external provider
acceptance is claimed.

## Source and local runtime checks

- Backend source unit suite: **1,620 passed** using
  `npm run test:unit -- --pool=threads --maxWorkers=1`.
- Published contract suite plus retirement/projection regressions: **116 passed**
  with a single thread worker. Retired routes have no success response, request
  body or former mandatory command-key requirements in the published contract.
- Manager/Staff focused UI, service and required typography tests: **17 passed**.
  Covers assignment/reassignment revisions, duplicate prevention, revocation reason,
  directory refresh after provisioning, event authorization failure, own task
  updates, incident creation and recipient-only handover visibility.
- Couple planning/group, seating and required typography tests: **17 passed**.
  The workspace does not request named lists, check-in settings or attendance;
  changing groups preserves the independent headcount and switching events clears
  prior-event data.
  Obsolete CSV/list/check-in/personalized-link UI and client calls were removed;
  the CSV feature's 11 tests were removed with that implementation.
- Flutter: **129 passed**, no APK packaging. Static analysis was also run.
- Both Next.js production builds passed using HTTPS placeholder URLs supplied only
  to the build process. Local `.env.local` uses HTTP and is intentionally rejected
  by production environment validation; it was not edited or weakened.
- Backend and both web type/lint checks, backend build, regenerated OpenAPI check
  and both web builds passed. No lint/type/test threshold was relaxed.
- Mutation review: changing the retirement HTTP status from 410 to 409 made **11
  assertions fail** with the expected 409-versus-410 mismatch. The mutation was
  restored and the actual implementation rechecked.

## Disposable database checks

`scripts/staff-operations.verify.mjs` enforces the existing loopback administrator
at `127.0.0.1:55435/wedding_local_demo`. It creates separately named test databases,
applies all 83 immutable migrations and removes only those disposable databases.

The three current-DB suites (staff-workspace, guest-management-http and
notification-guest-delivery) passed **13 tests**. The retained staff-operations
suite separately passed **12 tests**. These prove:

- Assigned events are readable with no named Guest or check-in configuration,
  even before event day; unassigned Staff/Couple cannot open the Staff workspace.
- New workspace output excludes attendance, check-in windows, guest lists and
  structured money fields. Missing seating no longer fails workspace validation.
- Task ownership/revisions, duplicate retries, immutable history, incident
  Manager authority and handover recipient/author rules remain enforced.
- Revocation denies workspace, history and retained-command replay and removes
  the event from Staff's list. Historical work remains stored.
- Named list/check-in/new personalized issuance return 410 for authenticated roles;
  group planning, historical invitation capability views and independent totals
  remain usable. Historical delivery retention/recovery remains testable offline.
- Legacy named rows do not block group archival or reset planning.

## Browser observations (controlled API fixtures)

Real Chromium rendering at 1440px desktop and 390px mobile verified Manager event
selection, staff selection, assignment and reasoned revocation; Staff event overview,
incident form/submission and absence of Manager/check-in controls; Couple planning
and groups without named-list/check-in requests. No horizontal page overflow was
observed. Vietnamese headings used sans-serif fonts and adequate line height.
The Staff tab bar was corrected after observing its second row clipped on mobile.

Local screenshots are in `output/playwright/`: manager-personnel-desktop/mobile,
staff-incident-mobile, staff-workspace-desktop, couple-groups-desktop/mobile. These
are local rendering evidence, not live-backend browser E2E. Synthetic realtime/API
fixtures account for initial connection/fallback messages; no production operations
were performed. Local browser/dev/realtime fixture servers were closed afterward.

## Broader-suite limitations

- The unchanged invitation-studio test `renders header and navigates across tabs`
  expects heading `Nội dung thiệp`, while the current UI renders `Thiết kế thiệp`.
  It fails identically on the original Couple Web HEAD **031f602**, reproduced in
  a detached temporary worktree with the same dependencies. It was not weakened.
- The unchanged populated-upgrade test attempts to use the current Prisma fixture
  before later catalog migrations. Setup fails because `MenuPackage.archivedAt`
  does not yet exist; its test cannot execute. No applied migration or fixture was
  changed to disguise this limitation. This revision introduces no SQL migration.
- Broad web-suite attempts did not complete and were stopped. One fork-based
  backend run had a Windows worker exit; the full source unit suite subsequently
  completed successfully with a single thread worker. Broad default DB attempts
  are not used as accepted database evidence; accepted DB runs use the isolation
  wrapper above. No full-project green CI claim is made.
- Cleanup of the detached baseline worktree was rejected by automatic review
  (`blocked by policy`). The temporary baseline directory and dependency junction
  were left intact. No user permission is needed to review the code changes.

Deployment, generated-client repinning to an actual released backend commit and
live acceptance remain a separate coordinated release.
