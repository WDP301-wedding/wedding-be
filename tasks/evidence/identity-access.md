# Identity-access acceptance evidence

Audit date: 2026-10-04 (Asia/Saigon)

Scope: `wedding-be`, `wedding-web`, `wedding-manage-web`, and `wedding-app`

Status: **Passed and approved at Checkpoint I3**

IA-17 was completed without opening SPEC-02. ACC-002 through ACC-007 have current
automated evidence, D1-D7 match runtime behavior, all repository gates pass, and the
previous D6, PostgreSQL, and Windows SWC blockers are resolved. On 2026-10-05 the
project owner explicitly instructed, “hãy hoàn tất Checkpoint I3,” approving the
completed implementation and this evidence. SPEC-02 specification/planning may now
begin; venue-catalog implementation still requires its own approved specification and
implementation plan.

## Audit environment and resolved blockers

- Node.js 24.15.0 and npm 11.7.0 satisfy the declared engine ranges.
- A disposable PostgreSQL 17 Docker container was exposed only on
  `127.0.0.1:55432`. Both committed migrations deployed from empty, all database and
  concurrency tests ran there, and the shared Supabase `public` schema was not used.
- The reusable Docker procedure and environment-variable boundary are recorded in
  `docs/cross-repo-development.md` for later acceptance runs.
- Four exact Node PIDs whose command lines belonged to the Public Web and Management
  Web `next dev` processes were stopped. This released
  `next-swc.win32-x64-msvc.node`; clean `npm ci` then passed in both repositories.
  The runbook records how to identify the owning process and prohibits blanket Node
  termination.
- Default multi-process Vitest workers were unstable on this Windows host: one backend
  process exited with `0xC0000409`, and simultaneous frontend fork pools timed out
  before loading tests. Serialized `threads` runs with one worker executed every test
  and passed. No failed assertion was hidden by the workaround.

## Repository gate results

| Gate | Backend | Public Web | Management Web | Android |
| --- | --- | --- | --- | --- |
| Clean `npm ci` | Pass, 536 packages | Pass, 304 packages | Pass, 304 packages | Pass, 1,098 packages |
| `npm run api:check` | Pass | Pass | Pass | Pass |
| `npm run format:check` | Pass | Pass | Pass | Pass |
| `npm run lint` | Pass | Pass | Pass | Pass |
| `npm run typecheck` | Pass | Pass | Pass | Pass |
| Full coverage | 566/566 tests; 96.92% lines / 92.50% branches | 23/23; 95.58% / 90.90% | 23/23; 95.58% / 90.90% | 20/20; 97.14% / 92.52% |
| Production build | Pass | Pass | Pass | Pass, Android export |
| `npm run audit:ci` | Pass, two documented exceptions | Pass, bounded dev-only advisory | Pass, bounded dev-only advisory | Pass, bounded Expo/build-tool advisories |

Additional results:

- `npm run db:generate`: pass; Prisma Client 7.10.0 generated deterministically.
- `npm run db:migrate:deploy`: pass from empty against disposable PostgreSQL 17; both
  committed migrations applied.
- Identity unit suite: 15 files and 150 tests passed with one worker.
- Backend integration/identity run: 34 files and 218 tests passed with one worker,
  including invitation acceptance/promotion, refresh/session/idempotency concurrency,
  migration policy, and the D6 executor.
- `npm run test:contract`: 4 files and 18 tests passed.
- D6-focused verification: 7 unit tests and 4 PostgreSQL integration tests passed.
- The retention CLI refuses to run without `--confirm-retention`; a confirmed empty
  batch returned zero anonymizations/deletions and no identifiers or PII.
- `npx expo-doctor`: pass, 21/21 checks.
- All four API drift checks verify SHA-256
  `84b109a0d6b0adc0e164a5ca798b76ee7fe1942feda8d106743d8e3a74c80be6`.

## ACC-002 through ACC-007 trace

| Requirement | Result | Exact automated evidence |
| --- | --- | --- |
| ACC-002 | Pass | `src/modules/identity-access/workspace-invitation/workspace-invitation.acceptance.test.ts` proves first-password enrollment plus restricted Web session behavior. `tests/integration/identity-access-invitation-acceptance-promotion.test.ts` proves atomic PostgreSQL acceptance. `wedding-web/src/test/app-smoke.test.tsx` proves fragment removal, memory-only state, and one-time acceptance. |
| ACC-003 | Pass | `src/modules/identity-access/authorization/authorization.service.test.ts` parameterizes proposal read and timeline read/edit/approve for restricted consultation access, including cross-consultation concealment. |
| ACC-004 | Pass | `src/modules/identity-access/authorization/authorization.service.test.ts` denies media, invitation, guest, seating, print, and event operations for restricted access; FULL access still delegates resource-state checks to the owning module. |
| ACC-005 | Pass | `tests/integration/identity-access-invitation-acceptance-promotion.test.ts` serializes concurrent promotion, stores one transition, and preserves account/access identity. |
| ACC-006 | Pass | `tests/integration/identity-access-workspace-invitation.test.ts` and `tests/integration/identity-access-invitation-acceptance-promotion.test.ts` cover expired/revoked/superseded/replayed invitations, revoke/reference preservation, and accept/accept races. |
| ACC-007 | Pass | `src/modules/identity-access/authorization/authenticated-actor.middleware.test.ts` fails closed for forged roles, revoked/expired credentials, revoked/idle/expired sessions, disabled accounts, invalid clocks, and malformed credentials. Public and Management Web tests keep backend denial authoritative. |

## D1-D7 and checkpoint review

- D1, D3, D4, D5, and D7 match the passing unit, contract, PostgreSQL integration,
  configuration, and client behavior in this audit.
- D2 matches all clients: Web access state is memory-only, Web refresh is cookie-based,
  Android refresh state is SecureStore-only, and Android asserts AsyncStorage is not
  used for refresh credentials.
- D6 now has an operator-only executor in
  `src/modules/identity-access/account/identity-retention.ts` and
  `scripts/identity-retention.ts`. It locks the approved 180/30/90/365-day policy,
  selects only due disabled accounts, transactionally requires a fact for every linked
  consultation, honors active holds, anonymizes email/display PII, deletes password
  verifiers, revokes live auth material, sets `piiAnonymizedAt`, retains only the UUID
  as a pseudonymous business/audit reference, and deletes terminal identity metadata
  after its approved window.
- D6 workers use PostgreSQL `FOR UPDATE SKIP LOCKED`; the PostgreSQL race test proves
  one account produces one anonymization and one audit row. Account and terminal
  metadata cleanup are both bounded by `batchSize`; re-runs are idempotent.
- I1 and I2 concurrency claims were freshly revalidated in the full PostgreSQL run.
  The project owner approved I3 on 2026-10-05.

## Contract, diff, secret, PII, log, and retention review

- The backend artifact, all three lock files, and all three generated client headers
  carry the same immutable OpenAPI digest; every drift check passed.
- Client working trees are clean. The backend tree contains only the IA-17 evidence,
  runbook, retention executor, tests, and package-script changes listed by `git status`.
- No `.env` file is tracked. The final high-confidence tracked/new-file scan found no
  private keys, cloud access tokens, GitHub tokens, Stripe-style keys, credentials, or
  unauthorized real-person PII. Email literals are reserved-domain values or test
  fixtures.
- `src/core/logging/logging.test.ts` proves recursive redaction of authorization,
  cookies, access tokens, email, phone, payment values, bodies, and provider errors.
  Database integration assertions also reject credential/email material in audit rows.
- The retention command requires an explicit confirmation flag, accepts only batch
  sizes 1-1,000, reports counts only, validates the exact approved policy, and is
  documented in `docs/identity-access-operations.md`.

## Verdict

The three previously recorded blockers are closed:

1. D6 has a tested, idempotent PostgreSQL anonymization/cleanup executor.
2. A disposable PostgreSQL 17 Docker workflow now proves clean migrations and all
   concurrency/integration suites and is documented for reuse.
3. The exact Next.js processes holding the SWC binaries were stopped and both clean
   installs plus complete frontend gates pass.

IA-17 passes and the project owner has approved Checkpoint I3. SPEC-02
specification/planning may begin. This approval does not authorize venue-catalog
implementation before SPEC-02 and its detailed implementation plan receive their own
explicit approval.
