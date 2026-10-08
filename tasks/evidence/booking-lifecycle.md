# Booking lifecycle checkpoint evidence

Recorded: 2026-10-08, Asia/Saigon.

Status: **BK-W7 implemented; BK-W8 technical verification complete, owner review pending. SPEC-03 is NOT ACCEPTED.**
BK-C4 still requires project-owner implementation
acceptance. This checkpoint leaves `tasks/todo.md` unchanged.

## Resuming the interrupted work

The existing `codex/booking-lifecycle` branch already contained W1–W6 backend work
and partial W7 consumers. This continuation completed missing provider composition,
reporting/automation hand-offs, retry-safe client commands, both Web timeline editors,
and Android confirmed-planning integration. It then closed gaps found by real
PostgreSQL and coverage checks. Current source changes are local and unpushed.

Starting repository heads, before this continuation's checkpoint:

| Repository | Starting HEAD |
| --- | --- |
| wedding-be | `168f61dd16fa58760b0d6238b7ebfd73503471c7` |
| wedding-manage-web | `bb3aa1e` |
| wedding-web | `0fe480e` |
| wedding-app | `7b1846c` |

These hashes identify the starting state. The verified implementation is now saved
as focused local commits; none have been pushed or merged.

| Repository | Verified implementation checkpoint |
| --- | --- |
| wedding-be | `f6d4a09` (documentation checkpoint follows this commit) |
| wedding-manage-web | `b70c67e` |
| wedding-web | `7d1826a` |
| wedding-app | `ef7f6c8` |

Local client API hand-off checkpoints created during this continuation:
Management `20ecec8`, Public `999bbd2`, Android `0c5ba21`. They contain the corrected
example API base, generated schema and frozen lock. Feature implementation and
verification changes remain separate from these API commits.

## Immutable API hand-off

- Frozen backend artifact commit (local, not yet pushed):
  `168f61dd16fa58760b0d6238b7ebfd73503471c7`.
- SHA-256: `cc57e41c60f5e8e4edf9c5c835f986a7e4b17bfd64bbb3853888b29a9968ff40`.
- All three clients pin this commit/digest and regenerate the OpenAPI schema.
  All four `api:check` commands pass for this artifact.
- The artifact includes consultation revisions and cancellation decisions. Later
  provider, audit and event-envelope work changes persistence/composition, without
  modifying the published HTTP artifact.

## Delivered behavior and requirement trace

| Requirement | Source / focused proof |
| --- | --- |
| ACC-001 | Consultation survives invitation delivery failure; durable delivery intent retries one identity invitation. `consultation.service.test.ts`, `consultation.repository.test.ts`, `identity-access-workspace-invitation.test.ts`, and `runtime.test.ts`. |
| TML-001/002 | Template/empty draft, stable item identity, ordering, text/time bounds and 100-item limit. `timeline.policy.test.ts`, `timeline.service.test.ts`, both Web `timeline-editor.test.tsx` files. |
| TML-003/004 | Canonical no-op saves, immutable successors, exact current-revision dual approvals and stale races. `timeline.repository.test.ts`, `timeline.service.test.ts`, `slot-hold-race.test.ts`, `runtime.test.ts`. |
| TML-005/006 | Backend commercial/deposit calculations, active/UNKNOWN intent fencing, exact settlement replay and real identity promotion. `deposit.policy.test.ts`, `deposit.repository.test.ts`, `deposit.service.test.ts`, `slot-hold-race.test.ts`, `runtime.test.ts`. |
| TML-007/008 | Previous effective timeline retained until both parties approve the replacement; history/audit persists. `timeline.repository.test.ts`, `runtime.test.ts`, Web page tests and native runtime sequence below. |
| Shared providers | Ordered headcount/conflict handling, historical reporting fence, replay-safe completion, scoped commercial/planning/timeline reads, and real rollback. Lifecycle/reader/automation unit tests, `booking-unit-of-work.test.ts`, `slot-hold-race.test.ts`, `runtime.test.ts`. |

Unless a full repository path is shown, backend module tests above live under
`src/modules/booking-lifecycle/`; integration tests live under `tests/integration/`.

Notable fixes in this continuation:

- Root-client lifecycle reads missed uncommitted settlement/promotion. A real
  PostgreSQL test first failed, then passed when every scoped read enlisted in the
  same transaction. Aborting the outer boundary removes settlement and promotion.
- Booking cancellation/completion now records identity-owned terminal retention
  evidence atomically. Two accounts linked to one consultation receive two facts
  for the same business record. No erasure policy or retention duration changed.
- Worker completion proves rollback when the retention callback fails, then one
  successful completion and one replay with the real identity recorder.
- Protected 401/403/404 denials persist redacted audit metadata containing only the
  operation pattern, status and error code. Audit failure fails closed with 503.
- Outbox rows persist version/correlation/causation. Payloads exclude private
  customer data and unrestricted cancellation text. See [ADR-004](../../docs/decisions/0004-enlist-booking-owner-providers-and-retention-evidence.md).
- Coverage includes booking feature code and actual HTTP adapters in both Web
  clients, preserving the existing per-file line/branch minimums.
- Android timeline hours have a sufficient fixed minimum width and one-line text;
  the regression test failed before the fix and passed afterward.

## PostgreSQL and migration proof

Docker uses a disposable local `postgres:17-alpine` container, separate from any
shared Supabase data. Tests create and remove their own databases/schemas. No real
payment gateway, email account, customer credential or live provider is used.

- All **14 migrations** apply to an empty database.
- Upgrade proof applies the first eight migrations, inserts a historical confirmed
  booking/proposal/invitation, then applies the six forward migrations.
- Invitation token hash, booking revision, phase, headcount and immutable proposal
  prices/hall name are preserved; delivery intent and reporting history backfill.
- The occupied-slot unique constraint rejects a second confirmed booking; the
  historical proposal remains immutable.
- Concurrent slot acquisition selects one winner. Reservation versus timeline
  change selects a valid serial order. Duplicate settlement records once, promotes
  the existing Couple identity, and leaves the confirmed slot unavailable.

New migrations, in order: invitation delivery intent, booking reporting, automation
command journal, confirmed slot uniqueness, outbox envelope metadata, and account
scope for retention evidence (`20261008000000` through `20261008005000`).

## Quality results

The final clean-install run passed **859 backend tests / 108 files**, **84 management tests /
12 files**, **50 public tests / 7 files**, and **30 Android tests / 3 suites**.
Line/branch coverage respectively: **96.80% / 92.73%**, **97.48% / 93.15%**,
**98.13% / 96.49%**, **96.66% / 88.55%**. Every configured per-file threshold passed.

Format, lint, typecheck, API check, coverage, production build/export, dependency-audit
policy and diff checks passed in all four repositories on the final source. Backend
includes real PostgreSQL integration, races, empty/upgrade migration and retention
rollback proof. Management was rerun after both browser fixes; Public and Android
were rerun after the clean install. Builds ran after preview servers were stopped.
Total feature/unit/integration tests: **1,023**, plus the audit-policy suites.

Dependency audit discovered a new Next.js advisory, GHSA-cjq9-62q9-8jv4. Both Web
repositories now target **Next.js 16.3.8**, the
[published patched version](https://github.com/vercel/next.js/releases/tag/v16.3.8). Existing
reviewed dev/build exceptions keep their original versions, scope and review dates.
No new advisory exception or forced dependency upgrade was introduced. npm dropped
27 optional platform entries during the update, even during lock-only regeneration.
Their exact original version, resolved URL and integrity were restored from the
committed lockfile, only after confirming each optional dependency's owner version
and declared range were unchanged. `npm ci --ignore-scripts --include=optional`
then verifies the corrected lockfile. No direct platform dependency was added.
Final clean Windows installs, native bindings, both Web runtime checks and patched
production builds passed. All four repositories completed clean dependency installs
with the declared npm version.

Backend audit passed with its two existing documented exceptions. Android audit
passed under its existing node-forge/braces exception through 2026-10-15; this is an
expiring deferral, **not zero vulnerabilities**. PostgreSQL runs emit the existing
`pg` concurrent-query deprecation warning; tests pass on the pinned driver version.

Environment recovery: the workstation resolves npm 11.6.0 by default, while the
repositories declare 11.19.0. An ignored local toolchain installs the exact official
npm 11.19.0 without lifecycle scripts. Final install/check commands prepend that
toolchain's `.bin` directory to the process PATH, without changing system settings.
The final check process also uses the existing bundled Node **24.19.0**, within the
declared Node 24 engine range. The workstation default is 24.15.0. In PowerShell,
use `npm.cmd` for forwarded script options; the generated `.ps1` shim consumes the
argument separator and can drop the intended worker/timeout options.
Clean installation uses `--no-audit` to separate package extraction from the explicit
required `audit:ci` gate. One overloaded Jest run exceeded its 5-second default, and
a subsequent backend thread-worker run exited with Windows `0xC0000409`. Neither
failed run is counted as passing. Recovery uses one test worker, a 30-second test
timeout, and a separate-process backend pool following the
[Vitest native-error guidance](https://vitest.dev/guide/common-errors#segfaults-and-native-code-errors).
The native crash's precise root cause is not established by that workaround.

## Android runtime evidence

Actual Android emulator + Expo Go 57.0.9 + Metro + real local HTTP API and PostgreSQL,
with synthetic accounts and catalog fixtures:

1. Couple signs in and loads a CONFIRMED booking: correct venue, event date, shift,
   headcount, phase and effective timeline revision 1.
2. A replacement is saved and only the Couple approves. Native reload still displays
   revision 1 and its original content.
3. The Manager approves the exact pending revision. Native reload displays revision 2
   and “Đón khách tại vườn”; the time `18:00` stays on one line after the layout fix.
4. Loading a different consultation with RESTRICTED access returns denial and clears
   the previous confirmed booking from the screen.

Manager/Couple preparation in steps 2–3 used real HTTP commands. This does **not**
claim those steps were executed through a browser interface. The preview server was
started before the latest internal audit/retention edits; the final backend tests
exercise those edits separately against fresh databases.

Ignored local artifacts in `wedding-app/test-results/booking-lifecycle/`:
`android-confirmed.png`, `android-pending-effective.png`,
`android-replacement-effective.png`, `android-restricted-denied.png`.
The replacement screenshot was recaptured and visually reviewed after the time fix.

## Browser evidence and remaining acceptance work

Earlier-session browser proof covers a Manager loading confirmed state and proposing
a replacement, Couple approval, restricted proposal presentation, and a 375px public
layout without overflow. It is partial historical evidence; the old fixture IDs no
longer exist in the newly created disposable database.

In this continuation, the enabled in-app browser twice failed to attach its webview,
for visible and hidden tabs. No controllable tab was returned. Browser troubleshooting
documentation was followed. Component tests and builds cannot close this runtime gate.
A subsequent app-panel bootstrap returned `queued` for this chat. After the user
confirmed the chat was open, the existing browser attached successfully.

Current-build browser verification uses Next.js 16.3.8, the real local API with all
14 migrations, Docker PostgreSQL, and disposable synthetic accounts. Actual UI
commands verified:

- Manager sign-in, consultation creation, invitation submission and retry, catalog
  selection, booking creation, availability and a 15-minute hold.
- Empty timeline save, add/edit/remove/reorder, and Manager approval. New browser
  booking: `e7da369f-a768-4631-883d-acc02f070201`.
- Couple proposal loading with consultation-scoped RESTRICTED access, dual approval,
  withdrawal and a successor revision whose previous approvals are cleared. No
  cancellation form is offered for the restricted consultation.
- Confirmed replacement proposed by Manager, approved by Couple and then Manager;
  the public UI displays revision 2 and both approvals. Previous-effective retention
  before second approval is proved by PostgreSQL and the Android sequence above;
  the public editor intentionally displays the current proposal.
- Future completion is refused while the booking stays CONFIRMED. Couple cancellation
  requests are first rejected, preserving CONFIRMED, then accepted for a new request,
  producing CANCELLED revision 14 with timeline/completion/cancellation commands disabled.
- A different, ungranted booking is denied and clears the previously displayed public
  proposal. Restoring a Couple session on Management Web denies management access.
- Two Manager tabs load revision 5; one saves revision 6. The other tab's old approval
  is rejected with the stale-revision message and commands stay disabled until reload.
- Stopping the owned local API leaves its port closed; submitting a command then shows
  an error and disables further commands. This is a server-disconnection check, not
  a claim of operating-system airplane-mode testing.
- Both Web interfaces fit 375px: measured document width 360px, viewport width 375px.
  Inputs have associated labels; Tab from the booking ID focuses the load button.
  Captured browser console warning/error lists were empty before deliberate API shutdown.

Two browser findings were repaired with failing-then-passing regression tests:
availability now allowlists only `hallId`, `eventDate`, `shiftCode` instead of sending
the entire booking form; temporary-hold actions are disabled for CONFIRMED, CANCELLED
and COMPLETED bookings. Controlled time inputs were verified using real keyboard
events, since this browser driver's fill-only operation did not update React time state.
Localhost ports share the same API session cookie; role switching was performed
sequentially with explicit logout/login to avoid treating revoked sessions as revision races.

Ignored screenshots: `wedding-manage-web/test-results/booking-lifecycle/` contains
`manager-draft.jpg`, `manager-cancellation-rejected.jpg`,
`manager-cancellation-approved.jpg`, `manager-mobile-width.jpg`,
`manager-stale-revision.jpg`, `manager-offline.jpg`.
`wedding-web/test-results/booking-lifecycle/` contains `couple-restricted.jpg`,
`couple-denied.jpg`, `couple-replacement-approved.jpg`, `couple-mobile-width.jpg`.

Remaining work, in order:

1. Review the recorded current-build browser/Android proof and acceptance matrix.
2. Review intended diffs and this evidence with the project owner. Only then mark
   BK-C4 / SPEC-03 ACCEPTED and begin SPEC-04 payment integration.

## SPEC-03 review and local-only checkpoint

Reviewed on 2026-10-08 against ACC-001 and TML-001 through TML-008, the approved
eight-wave plan, current source, and the runtime evidence above. BK-W1 through
BK-W7 are implemented; BK-W8 technical verification is complete. BK-C4 owner
acceptance remains pending, so this record does not mark SPEC-03 ACCEPTED or
authorize starting SPEC-04.

The owner subsequently requested **commits only, with publication and merge
deferred**. No feature branch was pushed, no pull request was created, and no
SPEC-03 change was merged into `main` during this review. The backend had already
integrated upstream `dc633a6` (Brevo email support) into the feature branch at
`2ca905a` before that instruction. The remaining three upstream branches had no
new commits to integrate. `tasks/todo.md` remains unchanged in this review.

Two functional gaps and one related access-denial path were closed:

- Booking invitations now use the canonical email-provider factory. This preserves
  disabled-email and Resend behavior and supports the newly integrated Brevo
  configuration. A real PostgreSQL/runtime HTTP regression proves that retrying
  the same invitation intent creates one identity invitation and makes one mocked
  Brevo request. It failed before the factory change and passed afterward; no live
  email credential or recipient was used.
- Management Web now offers published, active catalog timeline templates when the
  booking editor is empty (TML-001). It copies ordered title/description/time values
  into independently editable booking items, converts offsets relative to the
  booked shift, rejects milestones outside the shift, and omits catalog item IDs.
  Applying a template changes the local editor; only explicit Save persists a new
  booking-owned revision. Existing manual/empty-draft editing remains available.
- Template loading goes through the workspace's existing command/error boundary.
  An authenticated HTTP 401 clears the previously displayed proposal. The
  regression was rerun with a valid local API base: removing the fix leaves the
  private proposal visible and fails the assertion; restoring it passes.

Actual Management browser verification used the current template-copy UI, real
local HTTP API, all 14 migrations, disposable PostgreSQL, and synthetic accounts.
The Manager loaded a published template, edited its first title, and explicitly
saved a distinct DRAFT revision 4. The copied milestones were displayed at 17:00
and 17:30. At a 375px viewport the document and scroll widths were both 360px;
captured browser warning/error lists were empty. Ignored screenshot:
`wedding-manage-web/test-results/booking-lifecycle/manager-template-copy-review.png`.
This browser run predates the subsequent access-denial wrapper; that wrapper is
covered by the failing-then-passing HTTP regression and the final full Web suite.
Android implementation is unchanged; the recorded emulator sequence above still
applies, and its repository quality gates were rerun.

Final review gates passed in all four repositories: formatting, lint, typecheck,
immutable API check, full coverage tests, build, and dependency audit policy.

| Repository | Passing tests | Lines / branches | Latest implementation commit |
| --- | --- | --- | --- |
| wedding-be | 897 / 110 files | 96.84% / 92.79% | `70983d4` |
| wedding-manage-web | 91 / 13 files | 97.50% / 93.30% | `3e9d833` (template feature: `b577b01`) |
| wedding-web | 50 / 7 files | 98.13% / 96.49% | `7d1826a` (unchanged) |
| wedding-app | 30 / 3 suites | 96.66% / 88.55% | `ef7f6c8` (unchanged) |

Total: **1,068 passing feature/unit/integration tests**, plus audit-policy suites.
An earlier backend attempt found the disposable root database had no migrations
and failed foundation tests; it was not counted as passing. Applying all 14
migrations to the local Docker database and rerunning the full suite passed.
Database URLs were overridden to local port 55433 and live provider variables were
blanked in check processes. The owner's ignored `.env` files were not modified.

Review covered correctness, readability, module boundaries, security, and bounded
catalog loading. A separate timeline-policy mutation inverted the no-op condition,
failed two focused tests, and was restored. No mutation remains in committed code.
The frozen OpenAPI artifact and all three client pins are unchanged. Exact diff
and secret checks passed; `.env`, generated coverage, local logs, screenshots,
preview scripts, and build output are excluded from the commits. Generated Next
environment declarations were restored after build. Owned preview processes and
temporary browser tabs were closed and viewport overrides reset.

Audit gates retain their previously documented, expiring exceptions; a passing
audit policy is not a claim of zero vulnerabilities. Neither thresholds nor
exceptions were weakened for this checkpoint. Logs are ignored under each
repository's `test-results/spec03-review/`; the final backend coverage log is
`test-coverage-final.log`, and final Management logs use the `final-` prefix.

Next: review this checkpoint with the owner for BK-C4 acceptance. Publication,
GitHub CI, and merge await a later instruction. Actual payment-gateway integration
belongs to SPEC-04; SPEC-03's deposit-provider contracts and settlement behavior
are already covered by the PostgreSQL tests above.

## Reproduction notes

Provide `DATABASE_URL`, `MIGRATION_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL`
for a disposable PostgreSQL database via local environment variables; never use a
shared production database. Generate Prisma after installing backend dependencies.

```text
wedding-be:
  npm run db:generate
  npm run db:migrate:deploy
  npm.cmd run test:coverage -- --pool=forks --maxWorkers=1 --testTimeout=30000 --coverage.reportsDirectory=coverage/spec03-resume
all four repositories:
  npm run format:check
  npm run lint
  npm run typecheck
  npm run api:check
  npm run test:coverage
  npm run build
  npm run audit:ci
```

On this Windows workstation, use one Web Vitest worker if running several suites
alongside the emulator. Backend coverage is ignored at `coverage/spec03-resume/`;
client coverage and runtime screenshots are also ignored generated artifacts.
Owned preview processes and temporary environment files were removed after the
checks; generated Next environment declarations were restored. Browser viewport
overrides were reset and temporary tabs closed. The owned Docker PostgreSQL container
remains available for future disposable tests. Use the correct `/api/v1` base from
each corrected `.env.example` when restarting.

## Review remediation — 2026-10-08

The five backend review findings on codex/booking-lifecycle are addressed:

- Deposit reservation persists the initiating active consultation account. SYSTEM
  eligibility/reservation resolves the intended active recipient; grant creation order
  does not choose the beneficiary. Replay rejects a different authenticated account.
- Durable invitation replay accepts its original or the current consultation revision,
  preserving owner, recipient, and original evidence across booking creation.
- First mutual timeline approval freezes commercialRevisionId and commercialAcceptedAt
  on the immutable proposal in the same transaction. Reapproval preserves them;
  approved historical timelines remain readable after a successor. Migration
  20261008007000_booking_commercial_acceptance backfills existing dual-approved
  proposals while preserving their previous source IDs. The existing immutability
  trigger permits only the first acceptance attachment and rejects later mutation.
- Slot allocation reads PostgreSQL clock_timestamp() after its advisory lock, using
  the database clock for expiry, TTL and evidence. Clock-read failure refuses allocation.
- Direct cancellation and approved cancellation requests release unpinned ACTIVE holds
  atomically with cancellation and durable booking.slot-released evidence.

Independent verification uses a disposable PostgreSQL 18 cluster in UTC, with all
database URLs pointing to that cluster:

- Full suite and coverage: **111 files / 917 tests passed**, no skipped tests.
- Coverage: **96.85% lines, 92.81% branches**; existing 80% per-file gates pass.
- Command: npm run test:coverage -- --no-cache --no-fsModuleCache --maxWorkers=2 --pool=threads --testTimeout=30000 --hookTimeout=60000.
- Worker threads are used on this Windows host because coverage with worker forks
  crashes in the existing idempotency repository stress test. That test also passes
  independently with forks without coverage.
- Typecheck, production build, OpenAPI drift check, ESLint, and changed-file formatting pass.
- Six new PostgreSQL regression tests cover all five findings, unauthorized payer
  rejection, persisted acceptance, and database rejection of acceptance mutation.
- The upgrade test covers backfill from an existing immutable proposal and approvals.

This remediation preserves the owner-acceptance gate above. SPEC-04 implementation
remains a separate task; no acceptance or production migration is asserted here.
