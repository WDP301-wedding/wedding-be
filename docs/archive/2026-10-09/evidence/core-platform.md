# Core-platform acceptance evidence

Audit date: 2026-10-03 (Asia/Saigon)

Scope: `wedding-be`, `wedding-web`, `wedding-manage-web`, and `wedding-app`

Status: **Accepted by the project owner on 2026-10-03**

The local acceptance audit is complete. The configured migration target is the
shared Supabase `postgres` database at `db.zjibuegbbwzvdqrnujjf.supabase.co`, so
the audit did not risk applying migrations to that root schema. Instead, it
created a disposable local PostgreSQL 17 database, ran the exact
`npm run db:migrate:deploy` command successfully, and removed the container
afterward. The isolated migration-policy integration test also ran against a
new schema on the configured PostgreSQL service, deployed all committed
migrations, proved a forward compensating migration, and removed the schema.

The project owner reviewed this evidence and explicitly approved
`core-platform` implementation on 2026-10-03. That approval opens the Phase H
`identity-access` specification and detailed-planning gate. It does not
authorize `identity-access` implementation before that module's own spec,
detailed tasks, and human approval are complete.

## Audit environment

- The executor used Node.js 24.15.0 and npm 11.7.0, which satisfy the declared
  `>=24.11 <25` and `>=11 <12` engine ranges.
- Every repository pins Node.js 24.21.0 in `.node-version`; each CI workflow
  consumes that file through `actions/setup-node`.
- Every repository has exactly one npm lockfile. Clean `npm ci` completed in
  all four repositories.
- Real `.env` files are ignored and untracked. No dependency directory,
  coverage report, `dist`, `.next`, or `.expo` output is tracked.

## Repository gate results

| Gate | Backend | Public Web | Management Web | Expo App |
| --- | --- | --- | --- | --- |
| `npm ci` | Pass, 536 packages | Pass, 304 packages | Pass, 304 packages | Pass, 1,097 packages |
| `npm run format:check` | Pass | Pass | Pass | Pass |
| `npm run lint` | Pass | Pass | Pass | Pass |
| `npm run typecheck` | Pass | Pass | Pass | Pass |
| `npm test` | Pass, 342 tests | Pass, 16 tests | Pass, 16 tests | Pass, 11 tests |
| `npm run test:coverage` | Pass, 97.54% lines / 93.83% branches | Pass, 95.58% / 90.90% | Pass, 95.58% / 90.90% | Pass, 95.00% / 89.74% |
| `npm run build` | Pass | Pass | Pass | Pass, Android export |
| `npm audit --audit-level=high` | Findings reviewed below | Pass, zero findings | Pass, zero findings | Findings reviewed below |
| `npm run api:check` | Pass | Pass | Pass | Pass |

Additional backend and Expo evidence:

- `npm run test:integration`: pass, 43 tests in 10 files, including the
  isolated empty-schema migration policy.
- `npm run test:contract`: pass, 13 tests in 3 files.
- `npm run db:migrate:deploy`: pass against the empty disposable
  `wedding_cp32` PostgreSQL 17 database on local port 55432; the single
  `20260928000000_core_platform` migration applied successfully, and the
  container was removed afterward.
- `npx expo-doctor`: pass, 21/21 checks.
- Backend's first sandboxed test attempt failed only because Prisma could not
  update its engine cache under `%APPDATA%`; rerunning outside the filesystem
  sandbox passed all 342 tests. Expo Doctor had the same npm-cache sandbox
  limitation and passed outside the sandbox.

## Dependency findings and bounded exceptions

### Backend

Raw npm audit reports one moderate and four high package occurrences. The
high findings have two reviewed roots:

1. `deepmerge-ts` through `@prisma/config`: reachable only in the Prisma CLI,
   whose committed configuration is static and does not merge untrusted
   request/provider graphs.
2. `mysql2` through the Prisma CLI: unused by this PostgreSQL-only service,
   which uses the `postgresql` Prisma provider and `@prisma/adapter-pg`.

`npm run audit:ci` passed with the two documented exceptions in
`docs/dependency-audit-exceptions.json`. Backend maintainers own both
exceptions; both expire for review on 2026-10-16. The gate fails closed for a
new high/critical advisory, malformed audit data, or an expired exception.

### Expo App

Raw npm audit reports 9 moderate and 28 high propagated package occurrences.
All high occurrences resolve to `GHSA-86w9-cpqp-85rv` in `node-forge`, reached
through Expo CLI/code-signing tooling rather than the shipped application
runtime. Core-platform does not perform an EAS cloud build or enable OTA
updates, and no signing credential is present.

The mobile audit gate pins the reviewed `node-forge` version and its two direct
lockfile dependents, rejects direct app use or any new dependent/range, rejects
unresolved/cyclic-only causes and any other high/critical root, and expires at
2026-10-16T00:00:00Z. Mobile maintainers own re-review by 2026-10-15. All 13
audit-policy tests pass, and the real `npm run audit:ci` result confirms the
lockfile scope before allowing the single advisory temporarily.

Neither repository uses `npm audit fix --force`; the next compatible upstream
Prisma/Expo release must be reviewed and verified before an exception is
removed.

## OpenAPI and cross-repository integrity

- Backend `openapi/openapi.json` SHA-256:
  `eaf954a667801edcf94ba1db7c11a442d88a55b99de8c9020d6ac2675be76d8f`.
- Public Web, Management Web, and Expo all pin backend commit
  `2726eaa2b316da00890a73066610186a12967a36` and the same artifact digest in
  `api-contract.lock.json`.
- All four `api:check` commands pass. Each client verifies the digest before
  comparing its generated `schema.d.ts`; generated schemas are not hand
  edited.
- The four CI workflows are independent, fail closed, use read-only default
  permissions and SHA-pinned official actions, and contain no
  `continue-on-error` gate. Dependabot checks npm and GitHub Actions weekly
  with a five-PR limit in each repository.

## Working-tree and secret review

The audit reviewed all current diffs and untracked source/documentation files.
The remaining changes are intentional CP-30/CP-31/CP-32 artifacts:

- backend task/evidence and cross-repository documentation;
- one repository README per project; and
- the Expo audit-policy hardening plus its tests.

High-confidence secret scanning found no tracked private key, provider token,
or cloud credential. Tracked PostgreSQL URL literals occur only in
`.env.example`, CI, and tests and resolve to `localhost`, `127.0.0.1`, or
`db.example.com`. All `.env` files remain ignored and untracked.

## Success-criteria traceability

| # | Result | Command, test, or file evidence |
| --- | --- | --- |
| 1 | Pass | `CAPABILITY-MAP.md` retains the four repository ownership boundaries and approved capability order. |
| 2 | Pass | Four clean `npm ci` runs; four `.node-version` and `package.json` baselines; exactly one npm lockfile per repository. |
| 3 | Pass | The repository gate table records lint, typecheck, tests, coverage, and production build/export in all four repositories. |
| 4 | Pass | `src/core/http/lifecycle.test.ts`, `tests/integration/health.test.ts`, and the 342-test backend run cover start, readiness, bounded shutdown, and error paths. |
| 5 | Pass | The exact `npm run db:migrate:deploy` command applied the committed migration to an empty disposable local PostgreSQL 17 database. `tests/integration/migration-policy.test.ts` independently deployed into an empty isolated schema, verified forward compensation, and cleaned up; `src/core/database/prisma.ts` and `docs/database-migrations.md` document the Supabase-compatible connection mode. |
| 6 | Pass | `src/core/http/common.schemas.ts`, `src/core/http/http-contract.test.ts`, `src/core/http/request-context.ts`, and `tests/integration/common-errors.test.ts`. |
| 7 | Pass | Idempotency unit suites plus `tests/integration/idempotency-http.test.ts` and `tests/integration/idempotency-repository.test.ts` cover winner, replay, mismatch, in-flight duplicate, and terminal races. |
| 8 | Pass | Deterministic backend `api:check`, 13 contract tests, identical digest locks, and passing client `api:check` commands. |
| 9 | Pass | Storage, email, and AI-image interfaces/fakes/real adapters under `src/integrations`, with their provider test suites; no paid/network call is made by tests. |
| 10 | Pass | Logging, audit, metrics, redaction, and tracing unit/integration suites under `src/core/{logging,audit,observability}` and `tests/integration/{audit,metrics,request-logging}.test.ts`. |
| 11 | Pass | `.env.example`, `.gitignore`, the secret review above, zero web findings, and fail-closed bounded backend/mobile audit policies leave no unmitigated reachable critical/high production finding. |
| 12 | Pass | `wedding-app/src/app`, `app.config.ts`, `eas.json`, passing Android export, and Expo Doctor 21/21; the `preview` EAS cloud build remains explicitly deferred to `release-demo`. |

## Review verdict

Correctness, readability, architecture, security, and performance checks found
no remaining code defect that blocks `core-platform`. One documentation defect
found during the audit was corrected: the four onboarding documents now name
the Node.js 24.21.0 version pinned in `.node-version` instead of 24.11.x.

All CP-32 acceptance and verification items are satisfied. The project owner
approved `core-platform` implementation on 2026-10-03, so Checkpoint G3 is
complete. Phase H may proceed with the `identity-access` specification and
detailed planning only; implementation retains its separate approval gate.
