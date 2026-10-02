# Task List: Wedding Management System

Core-platform task list status: Approved by project owner on 2026-09-24<br>
Post-core specification sequence status: Approved by project owner on 2026-09-27<br>
Plan: [`plan.md`](./plan.md)<br>
Platform specification: [`../SPEC-core-platform.md`](../SPEC-core-platform.md)<br>
Product requirements: [`../PRODUCT-REQUIREMENTS.md`](../PRODUCT-REQUIREMENTS.md)<br>
Capability map: [`../CAPABILITY-MAP.md`](../CAPABILITY-MAP.md)

## Working Rules

- Complete tasks in dependency order; tasks explicitly marked parallel may use separate repository branches/sessions.
- A task is complete only when every acceptance and verification checkbox is satisfied.
- Keep human-authored scope to approximately five files. Framework-generated scaffold files are the only documented exception and must be reviewed as a single generated change.
- Update the approved spec before changing a locked architecture decision.
- Do not use live Supabase, Resend, Gemini, or EAS credentials in automated tests.
- Commit each verified task or tightly coupled task pair as an atomic save point in its owning repository.
- Preserve completed CP checkboxes and evidence as implementation history; extending the plan must not reopen or rewrite completed work without a documented reason.
- Do not implement a post-core module until its `SPEC-<module-id>.md`, detailed vertical tasks, and human approval gate exist.
- Every post-core module spec and task slice must trace its owned identifiers from `PRODUCT-REQUIREMENTS.md`.

## Phase A — Reproducible Repository Foundations

### CP-01: Establish the backend package and compiler baseline

**Description:** Create the Node 24/npm/TypeScript foundation for `wedding-be`, pin the approved backend dependencies, and expose the common script names required by the spec.

**Acceptance criteria:**

- [x] `package.json` pins Node 24, npm, TypeScript 5.9.3, Express 5.2.1, Prisma 7.10.0, and the approved core dependencies without preview tags.
- [x] ESM and strict compiler options are configured for development and production output.
- [x] A clean install produces exactly one committed npm lockfile.

**Verification:**

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] Inspect `npm ls --depth=0` for unexpected major versions.

**Implementation evidence (2026-09-24):** `npm ci`, typecheck, and production compilation pass; registry signatures verify for all 240 installed packages. A full `npm audit` reports four high advisories below the Prisma 7 CLI (`deepmerge-ts` and `mysql2`). `npm explain` confirms that path enters through the root development dependency and Prisma's optional peer; the application uses PostgreSQL and does not execute either affected code path. npm only offers a forced downgrade to Prisma 6.19.3, which conflicts with the approved Prisma 7 baseline, so no forced fix or unverified override was applied. Recheck by 2026-10-08 or when the next stable Prisma 7 patch is available.

**Dependencies:** None  
**Files likely touched:** `wedding-be/package.json`, `wedding-be/package-lock.json`, `wedding-be/.node-version`, `wedding-be/tsconfig.json`, `wedding-be/tsconfig.build.json`  
**Estimated scope:** Medium

### CP-02: Add backend lint, formatting, and unit-test harness

**Description:** Add flat ESLint, Prettier, Vitest 5, coverage configuration, safe ignores, and a first smoke test so quality commands are real from the start.

**Acceptance criteria:**

- [x] ESLint uses flat config and TypeScript-aware rules; Prettier is the only formatter.
- [x] Vitest runs in Node mode and enforces the approved core coverage thresholds.
- [x] Secrets, dependencies, build output, reports, and local environment files are ignored.

**Verification:**

- [x] `npm run lint`
- [x] `npm run test:coverage`
- [x] `npm run build`

**Implementation evidence (2026-09-25):** A script-disabled install and lifecycle review found only the already-approved Prisma and esbuild install hooks; the Windows-only result excludes optional `fsevents`. A normal `npm ci` then installed 375 packages successfully. Prettier check, typed ESLint, TypeScript typecheck, two Node/ESM smoke tests, per-file 80% line/branch coverage enforcement, and the production build all pass. The current empty backend entry point has no executable statements, so coverage reports `0/0` as 100%; the configured `include` and per-file thresholds will begin measuring every non-test TypeScript source file as implementation is added. Registry signatures verify for all 375 packages, and the four known Prisma CLI advisories remain unchanged from CP-01 with no new advisory introduced by the quality toolchain.

**Dependencies:** CP-01  
**Files likely touched:** `wedding-be/eslint.config.mjs`, `wedding-be/prettier.config.mjs`, `wedding-be/vitest.config.ts`, `wedding-be/src/core/smoke.test.ts`, `wedding-be/.gitignore`  
**Estimated scope:** Medium

#### Checkpoint A1 — Backend toolchain

- [x] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [x] No secrets or build outputs appear in `git status`.

### CP-03: Establish the Public Web Next.js baseline

**Description:** Scaffold `wedding-web` with Next.js 16.3.6 App Router, React 19.2.3, strict TypeScript, npm, and API-contract dependencies.

**Acceptance criteria:**

- [x] The repository uses App Router and contains no backend/database dependency.
- [x] Node, TypeScript, Next.js, React, lint/test, and API-client packages are pinned to approved stable lines.
- [x] Public environment parsing recognizes only non-secret public configuration.

**Verification:**

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] `npm ls next react react-dom typescript`

**Implementation evidence (2026-09-25):** `wedding-web` commit `8942770` establishes the App Router directory and pins Node 24.21.0, Next.js 16.3.6, React/React DOM 19.2.3, TypeScript 5.9.3, Vitest 5.0.1, Zod 4.6.5, `openapi-fetch` 0.17.0, and `openapi-typescript` 7.13.0. A normal `npm ci` installs 248 packages with no audit findings; route type generation, strict typecheck, ESLint 10, Prettier, and five public-environment boundary tests pass. The environment parser allowlists only `NEXT_PUBLIC_API_BASE_URL`, requires HTTPS in production, and permits cleartext only for loopback development URLs. The official direct `@next/eslint-plugin-next` integration is used because the transitive React plugins bundled by `eslint-config-next` 16.3.6 do not yet execute under the spec-mandated ESLint 10 runtime.

**Dependencies:** None; may run in parallel with CP-01, CP-05, and CP-07.  
**Files likely touched:** framework-generated Next.js configuration set plus `wedding-web/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-04: Add the Public Web shell and quality harness

**Description:** Create a minimal Public/Guest/Couple route-group shell and prove that lint, tests, and a production build work without adding product UI.

**Acceptance criteria:**

- [x] The root route renders a neutral foundation page and route groups exist without business screens.
- [x] Vitest/Testing Library has one rendering smoke test.
- [x] ESLint, formatting, test, and build scripts match the shared command contract.

**Verification:**

- [x] `npm run lint`
- [x] `npm run test:coverage`
- [x] `npm run build`

**Implementation evidence (2026-09-25):** `wedding-web` commit `66df8bd` adds the neutral App Router root shell and tracked `(public)`, `(guest)`, and `(couple)` route-group placeholders without business screens. Vitest 5 runs in jsdom with Testing Library React 16.3.3, a shared cleanup setup, one semantic rendering smoke test, and per-file 80% line/branch coverage gates; the complete six-test suite reports 88.88% line and 100% branch coverage. Exact dev dependencies preserve the existing Node engine contract, lifecycle review found no new install script, and `npm audit` reports no vulnerabilities. A clean `npm ci`, formatting check, typed ESLint, route type generation, strict TypeScript check, unit tests, coverage, and the Next.js production build all pass. Browser verification confirms the prerendered `/` route has the expected main/heading structure and no console warning or error.

**Dependencies:** CP-03  
**Files likely touched:** `wedding-web/app/layout.tsx`, `wedding-web/app/page.tsx`, `wedding-web/eslint.config.mjs`, `wedding-web/vitest.config.ts`, `wedding-web/src/test/app-smoke.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A2 — Public Web toolchain

- [x] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [x] No API secret or backend package exists in the browser bundle configuration.

### CP-05: Establish the Management Web Next.js baseline

**Description:** Scaffold `wedding-manage-web` independently with Next.js 16.3.6, React 19.2.3, strict TypeScript, npm, and API-contract dependencies.

**Acceptance criteria:**

- [x] The repository is an independent App Router application for Manager/Staff surfaces.
- [x] It does not import the Public Web repository or backend source.
- [x] Public environment parsing permits only the API base URL and other explicitly public values.

**Verification:**

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] `npm ls next react react-dom typescript`

**Implementation evidence (2026-09-25):** `wedding-manage-web` commit `fec1d73` establishes the independent App Router baseline and pins Next.js 16.3.6, React/React DOM 19.2.3, TypeScript 5.9.3, Zod 4.6.5, `openapi-fetch` 0.17.0, and `openapi-typescript` 7.13.0. A clean `npm ci` installs 248 packages with dependency lifecycle scripts disabled and no audit findings; route type generation, strict typecheck, ESLint 10, Prettier, and five public-environment boundary tests pass. The environment parser allowlists only `NEXT_PUBLIC_API_BASE_URL`, requires HTTPS in production, permits cleartext only for loopback development URLs, and has no source import from the Public Web or backend repositories.

**Dependencies:** None; may run in parallel with CP-01, CP-03, and CP-07.  
**Files likely touched:** framework-generated Next.js configuration set plus `wedding-manage-web/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-06: Add the Management Web shell and quality harness

**Description:** Create a minimal Auth/Manager/Staff route-group shell and prove all local quality commands without implementing RBAC or domain screens.

**Acceptance criteria:**

- [x] Auth, Manager, and Staff route groups exist as structure only.
- [x] Vitest/Testing Library has one rendering smoke test.
- [x] Lint, typecheck, test, coverage, and build use the same command names as Public Web.

**Verification:**

- [x] `npm run lint`
- [x] `npm run test:coverage`
- [x] `npm run build`

**Implementation evidence (2026-09-26):** `wedding-manage-web` commit `1331061` adds the neutral App Router root shell, tracked `(auth)`, `(manager)`, and `(staff)` route-group placeholders, and a static application icon without introducing RBAC or domain screens. Vitest 5 runs in jsdom with Testing Library React 16.3.3, shared cleanup, one semantic rendering smoke test, and per-file 80% line/branch coverage gates; the complete six-test suite reports 88.88% line and 100% branch coverage. Management Web now exposes the same lint, formatting, typecheck, test, coverage, watch, and build command names as Public Web. A clean `npm ci`, ESLint, strict TypeScript checking, unit tests, coverage, formatting check, and the Next.js production build all pass with no audit findings. Browser verification confirms the `/` route renders the expected `main` and level-one heading at 320, 768, 1024, and 1440 pixel widths with no console errors or warnings.

**Dependencies:** CP-05  
**Files likely touched:** `wedding-manage-web/app/layout.tsx`, `wedding-manage-web/app/page.tsx`, `wedding-manage-web/eslint.config.mjs`, `wedding-manage-web/vitest.config.ts`, `wedding-manage-web/src/test/app-smoke.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A3 — Management Web toolchain

- [x] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [x] Manager and Staff are only route partitions; no client-side authorization is treated as authoritative.

### CP-07: Establish the Expo SDK 57 baseline

**Description:** Scaffold `wedding-app` as an Android-first Expo SDK 57 project using Expo Router, strict TypeScript, npm, and SDK-compatible package installation.

**Acceptance criteria:**

- [x] Expo SDK 57, React Native 0.86, and React 19.2.3 are resolved compatibly.
- [x] `src/app` is the router root and secrets are not exposed through `EXPO_PUBLIC_*`.
- [x] The repository declares Android as the required platform without deleting framework-required iOS metadata prematurely.

**Verification:**

- [x] `npm ci`
- [x] `npx expo-doctor`
- [x] `npm run typecheck`

**Implementation evidence (2026-09-27):** `wedding-app` commit `d0b911a` establishes the Android-first managed/CNG baseline from Expo's official SDK 57 template. The resolved root versions are Expo 57.0.25, React Native 0.86.3, React 19.2.3, and the approved cross-repository TypeScript 5.9.3 pin; Expo's documented dependency-validation exclusion records that deliberate TypeScript exception while all other managed packages pass `npx expo install --check`. `src/app` is the tracked router root without introducing the CP-08 shell, `app.config.ts` explicitly supports Android while preserving generated iOS icon metadata, and the Zod environment boundary allowlists only the public API URL plus optional EAS project ID with production HTTPS enforcement. A script-disabled `npm ci` installs 584 packages, strict typecheck passes, Expo Doctor passes all 21 checks, and registry verification confirms signatures for all 584 packages plus attestations for 159. `npm audit --omit=dev --audit-level=high` reports no high or critical finding; 14 moderate advisories remain in Expo Router/CLI transitive packages, and npm's only forced remediation would install SDK-incompatible package lines, so no forced fix was applied. Recheck by 2026-10-11 or when a compatible Expo SDK 57 patch is available.

**Dependencies:** None; may run in parallel with CP-01, CP-03, and CP-05.  
**Files likely touched:** framework-generated Expo configuration set plus `wedding-app/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-08: Add the Expo Router shell and Android test harness

**Description:** Add route-only navigation structure for Auth/Couple, a minimal screen body outside the router tree, and SDK-compatible Jest coverage.

**Acceptance criteria:**

- [x] `src/app` contains route files only; screen UI lives under `src/screens`.
- [x] A smoke test renders the initial screen with `jest-expo`.
- [x] Android JS export/build script succeeds without requiring a cloud build.

**Verification:**

- [x] `npm run lint`
- [x] `npm run test:coverage`
- [x] `npm run build`
- [x] `npx expo-doctor`

**Implementation evidence (2026-09-27):** `wedding-app` commit `50bb656` adds a thin Expo Router root stack, tracked `(auth)` and `(couple)` route-group placeholders, and a neutral initial screen whose UI body lives under `src/screens`. The SDK-compatible harness pins `jest-expo` 57.0.5, Jest 29.7.0, React Native Testing Library 14.0.1, and `test-renderer` 1.2.0 for React 19.2.3; the smoke test reports 100% statement, branch, function, and line coverage for the screen. A script-disabled clean install resolves 1,074 packages, Expo dependency validation passes with only the approved TypeScript exclusion, lint, formatting, strict typecheck, and coverage pass, the Android production JS export bundles 1,191 modules without EAS or cloud credentials, and Expo Doctor passes all 21 checks. The high-severity audit gate reports no high or critical finding; the remaining moderate advisories are in the existing Expo/Expo Router transitive graph and currently have no compatible non-breaking remediation.

**Dependencies:** CP-07  
**Files likely touched:** `wedding-app/src/app/_layout.tsx`, `wedding-app/src/app/index.tsx`, `wedding-app/src/screens/home.tsx`, `wedding-app/jest.config.js`, `wedding-app/src/screens/home.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A4 — Expo toolchain

- [x] Clean install, lint, typecheck, test, coverage, Android export, and Expo Doctor pass.
- [x] No product feature, iOS acceptance work, or privileged Supabase client is introduced.

## Phase B — Backend Process and HTTP Contract

### CP-09: Implement the backend environment boundary

**Description:** Parse all core backend configuration once with Zod, expose immutable typed configuration, and fail fast on invalid production values.

**Acceptance criteria:**

- [x] Required, optional, conditional, URL, origin-list, boolean, and numeric settings follow the approved spec.
- [x] Enabling a provider without its required configuration fails before server start.
- [x] Tests cover valid development/test values and every required production failure branch.

**Verification:**

- [x] `npm run test:unit -- env`
- [x] `npm run typecheck`
- [x] Manually start with one required variable absent and confirm a redacted startup failure.

**Implementation evidence (2026-09-28):** The backend now allowlists and parses all 18 approved environment variables once through Zod, exposes a deeply frozen typed configuration, applies safe development/test defaults, and enforces deployed CORS, PostgreSQL TLS, database, Supabase Storage, and Resend requirements. Storage and email configuration is all-or-none; Gemini credentials are required only when its provider is selected; metrics require a token only when enabled; optional OTLP configuration remains disabled when blank. The focused environment suite passes 47 tests covering every required staging/production omission, numeric/boolean/URL/origin failures, conditional provider branches, immutability, and secret-safe errors. Typecheck, ESLint, Prettier, production build, and the complete coverage suite pass with 100% statement, branch, function, and line coverage. A production module startup with only `RESEND_API_KEY` absent exited before application composition with `EnvironmentConfigurationError: Invalid environment configuration: RESEND_API_KEY.` and did not print any configured secret value.

**Dependencies:** CP-01, CP-02  
**Files likely touched:** `wedding-be/.env.example`, `wedding-be/src/config/env.ts`, `wedding-be/src/config/config.ts`, `wedding-be/src/config/env.test.ts`  
**Estimated scope:** Medium

### CP-10: Compose Express and implement graceful lifecycle

**Description:** Separate application construction from process startup, add bounded shutdown for HTTP/resources, and keep imports free of listen-side effects.

**Acceptance criteria:**

- [x] `createApp` returns a testable Express app without opening a port.
- [x] `server.ts` owns listen, SIGINT/SIGTERM, readiness state, and bounded cleanup.
- [x] Startup and shutdown behavior is covered without orphaning handles.

**Verification:**

- [x] `npm run test:unit -- lifecycle`
- [x] `npm run build`
- [x] Start and terminate locally; process exits cleanly within the configured deadline.

**Implementation evidence (2026-09-28):** `createApp` now composes Express without opening a socket, while the import-safe `server.ts` bootstrap loads and validates configuration before application or HTTP-server construction. The server owns listening, readiness transitions, SIGINT/SIGTERM registration, deterministic process exit codes, and idempotent shutdown. The lifecycle drains HTTP before closing registered resources, aggregates cleanup failures, enforces a 10-second default deadline, and force-closes connections/resources on failure or timeout. The focused lifecycle suite passes 15 tests covering side-effect-free composition, config-before-listen behavior, bind failure cleanup, readiness, both process outcomes, duplicate shutdown calls, cleanup errors, and deadline enforcement without leaked listeners or servers. The complete 64-test coverage suite, strict typecheck, ESLint, Prettier, and production build pass. A production-build harness opened a listener and handled SIGTERM with exit code 0 in 5 ms; a production start with invalid configuration exited 1 without opening port 3001.

**Dependencies:** CP-09  
**Files likely touched:** `wedding-be/src/app.ts`, `wedding-be/src/server.ts`, `wedding-be/src/core/http/lifecycle.ts`, `wedding-be/src/core/http/lifecycle.test.ts`  
**Estimated scope:** Medium

#### Checkpoint B1 — Process lifecycle

- [x] Invalid configuration never opens a listening port.
- [x] App construction and process startup are independently testable.

### CP-11: Implement request context, standard errors, and validation

**Description:** Establish request IDs, typed application errors, one error envelope, 404 behavior, and reusable Zod validation at HTTP boundaries.

**Acceptance criteria:**

- [x] Valid trusted request IDs are propagated; otherwise UUIDs are generated and returned.
- [x] Validation, not-found, conflict, rate-limit, provider, and unexpected errors map consistently without stack leakage.
- [x] Write schemas reject unknown fields unless explicitly documented.

**Verification:**

- [x] `npm run test:unit -- http-contract`
- [x] `npm run test:integration -- common-errors`
- [x] Inspect test responses for `error.code`, `error.message`, and `error.requestId`.

**Implementation evidence (2026-09-28):** The Express composition root now installs request correlation before JSON parsing, accepts upstream IDs only through an injected trust policy plus UUID validation, generates safe fallback UUIDs, and returns `x-request-id` on success and failure. Typed application errors and the terminal error middleware provide one non-leaking envelope for malformed JSON, validation, 404, conflict, rate-limit (including `Retry-After`), provider `502`/`503`/`504`, and unexpected failures. Reusable async Zod boundary validation covers params, query, headers, and bodies; `strictWriteSchema` rejects undocumented fields and exposes typed parsed inputs. The focused unit suite passes 21 tests, the common-error integration suite passes 10 tests, the complete 95-test coverage suite passes with 96.57% line and 94.18% branch coverage, and error mapping has 100% branch coverage. Strict typecheck, ESLint, Prettier, and the production build pass. A clean `npm ci --ignore-scripts` also succeeds. The dependency audit's four existing high findings remain isolated to the Prisma CLI/configuration graph (`deepmerge-ts` and unused MySQL support); they are not introduced by the test-only Supertest dependency, are not reachable from this PostgreSQL HTTP runtime, and npm offers only a spec-incompatible Prisma 6 downgrade. Recheck by 2026-10-12 or during CP-32, whichever comes first.

**Dependencies:** CP-10  
**Files likely touched:** `wedding-be/src/core/http/request-context.ts`, `wedding-be/src/core/errors/app-error.ts`, `wedding-be/src/core/errors/error-handler.ts`, `wedding-be/src/core/http/validate.ts`, `wedding-be/tests/integration/common-errors.test.ts`  
**Estimated scope:** Medium

### CP-12: Deliver liveness and readiness endpoints

**Description:** Add a complete first vertical HTTP slice with dependency-free liveness and an injected, timeout-bounded readiness probe.

**Acceptance criteria:**

- [x] `/health/live` returns success without calling dependencies.
- [x] `/health/ready` returns success/failure from the probe and uses `503` when unavailable.
- [x] Both responses carry request IDs and use stable schemas suitable for OpenAPI generation.

**Verification:**

- [x] `npm run test:integration -- health`
- [x] `npm run build`
- [x] Force the readiness probe to fail and confirm liveness remains healthy.

**Implementation evidence (2026-09-28):** The Express composition root now exposes schema-backed `GET /health/live` and `GET /health/ready` endpoints with correlated request IDs in both the response header and body. Liveness never invokes the dependency probe. Readiness composes the server lifecycle state with an injected abort-aware dependency probe, enforces a one-second default timeout, short-circuits dependencies while the process is not ready, and normalizes rejection or timeout to the standard non-leaking `503 SERVICE_UNAVAILABLE` envelope. Exported strict Zod response schemas carry stable OpenAPI metadata for later contract generation. The focused health integration command passes 16 tests across the integration suite, including forced rejection, timeout, and lifecycle-not-ready scenarios where liveness remains `200`; the readiness unit suite passes 2 timeout-validation tests. The complete 103-test suite passes, coverage passes with 97.28% line and 94.73% branch coverage, and strict typecheck, ESLint, Prettier, and the production build pass.

**Dependencies:** CP-09, CP-10, CP-11  
**Files likely touched:** `wedding-be/src/core/http/health.router.ts`, `wedding-be/src/core/http/readiness.ts`, `wedding-be/src/core/http/health.schemas.ts`, `wedding-be/src/app.ts`, `wedding-be/tests/integration/health.test.ts`  
**Estimated scope:** Medium

#### Checkpoint B2 — HTTP foundation

- [x] All backend static and unit/integration gates pass.
- [x] Health, 404, validation, and unexpected-error responses match the spec exactly.

## Phase C — PostgreSQL and Reliability Primitives

### CP-13: Configure Prisma/PostgreSQL and create the initial migration

**Description:** Configure Prisma 7 with the PostgreSQL driver adapter, separate runtime/migration URLs, and create the initial infrastructure-only schema.

**Acceptance criteria:**

- [x] Prisma uses `DATABASE_URL` at runtime and `MIGRATION_DATABASE_URL` for migration commands.
- [x] The initial migration creates only `AuditLog`, `IdempotencyRecord`, required enums/indexes, and Prisma metadata.
- [x] A PostgreSQL-backed integration test proves connect, transaction, and clean migration deployment.

**Verification:**

- [x] `npm run db:generate`
- [x] `npm run db:migrate:deploy` against an empty disposable PostgreSQL database.
- [x] `npm run test:integration -- database`

**Implementation evidence (2026-09-28):** Prisma 7.10 now generates an ESM client from the PostgreSQL-only infrastructure schema and uses the `@prisma/adapter-pg` runtime factory with `DATABASE_URL`; CLI scripts explicitly load `prisma.config.ts`, which reads only `MIGRATION_DATABASE_URL`. The immutable initial migration creates `AuditLog`, `IdempotencyRecord`, their two enums, uniqueness constraint, operational indexes, and Prisma's deployment metadata. On an empty disposable local PostgreSQL instance, `db:migrate:deploy` applied the single migration, the database integration suite passed all 20 tests (including connection, migration metadata, commit, and rollback), and Prisma reported no migration/schema drift. The complete 105-test suite passes with 97.34% line and 94.87% branch coverage; strict typecheck, ESLint, Prettier, and the production build pass. The existing npm audit findings remain confined to Prisma's CLI/configuration graph and unused MySQL support; this change adds no dependency or lockfile delta.

**Dependencies:** CP-09, CP-10  
**Files likely touched:** `wedding-be/prisma/schema.prisma`, `wedding-be/prisma.config.ts`, `wedding-be/prisma/migrations/<timestamp>_core_platform/migration.sql`, `wedding-be/src/core/database/prisma.ts`, `wedding-be/tests/integration/database.test.ts`  
**Estimated scope:** Medium

### CP-14: Deliver the durable audit-log slice

**Description:** Implement typed, append-only audit recording with metadata allowlisting and request-context attribution.

**Acceptance criteria:**

- [x] The service records actor, action, entity, request ID, timestamp, and redacted metadata.
- [x] No update/delete operation exists in the application repository contract.
- [x] Tests prove secret/PII fields are rejected or redacted before persistence.

**Verification:**

- [x] `npm run test:unit -- audit`
- [x] `npx vitest run tests/integration/audit.test.ts`
- [x] Query the test table and confirm stored metadata matches the allowlist.

**Implementation evidence (2026-09-29):** Typed audit-event definitions construct strict Zod metadata allowlists, and the audit service validates UUID request/actor/entity attribution, rejects unknown or non-JSON metadata before persistence, assigns an injectable timestamp, and delegates only an immutable append record. The application-facing repository contract exposes only `append`; its Prisma adapter creates `AuditLog` rows without update/delete methods. All nine focused unit tests pass, including password, email, refresh-token, invalid-value, invalid-attribution, non-JSON, append-only-contract, and deterministic timestamp cases. Against the configured Supabase PostgreSQL database through its TLS session pooler, both focused integration tests pass: the persisted JSONB row is queried back with exactly `fromStatus`, `reasonCode`, and `toStatus`, while a payload containing password/email fields is rejected before persistence and leaves no row. The integration command is the exact file path because appending `audit` to the directory-based npm script also selects unrelated integration files. The previous complete non-database suite passed 114 tests with 97.51% line and 95.14% branch coverage; the audit-only coverage run was 100% statements, branches, functions, and lines. Strict typecheck, ESLint, Prettier, and the production build passed. `npm audit` still reports the pre-existing Prisma CLI/configuration findings in `deepmerge-ts` and unused MySQL support; this slice adds no dependency or lockfile change.

**Dependencies:** CP-11, CP-13  
**Files likely touched:** `wedding-be/src/core/audit/audit.types.ts`, `wedding-be/src/core/audit/audit.repository.ts`, `wedding-be/src/core/audit/audit.service.ts`, `wedding-be/src/core/audit/audit.service.test.ts`, `wedding-be/tests/integration/audit.test.ts`  
**Estimated scope:** Medium

#### Checkpoint C1 — Persistence and audit

- [x] Fresh migration and rollback-by-new-forward-migration policy are documented and verified.
- [x] Audit tests prove append-only application behavior and redaction.

**Checkpoint evidence (2026-10-01):** `docs/database-migrations.md` now documents the runtime/migration connection boundary, immutable applied migrations, fresh-database verification, failed-migration recovery boundary, and the required forward-compensation workflow for released schema changes. `tests/integration/migration-policy.test.ts` creates a unique disposable PostgreSQL schema, deploys the complete committed migration history from empty, applies a probe migration, and then compensates it with a later migration. The rehearsal verifies the original probe SQL remains unchanged, both migration history rows remain successfully applied rather than marked rolled back, and the final schema no longer contains the probe column. The focused rehearsal passes against a disposable PostgreSQL 17 database; the bounded full suite passes all 335 tests with 97.54% line and 93.83% branch coverage. Strict typecheck, ESLint, Prettier, production build, and deterministic OpenAPI verification also pass.

### CP-15: Implement atomic idempotency persistence

**Description:** Build canonical request hashing, atomic database claims, state transitions, retention timestamps, and concurrency tests independent of Express.

**Acceptance criteria:**

- [x] `(namespace, idempotencyKey)` uniqueness atomically selects one winner.
- [x] Canonical hashing is deterministic and detects same-key/different-payload use.
- [x] Real concurrent PostgreSQL tests show exactly one successful claim.

**Verification:**

- [x] `npm run test:unit -- idempotency-hash`
- [x] `npm run test:integration -- idempotency-repository`
- [x] Repeat the concurrency test enough times to detect a check-then-insert race.

**Implementation evidence (2026-09-29):** Canonical request hashing now recursively sorts object keys, preserves array order and JSON scalar types, produces lowercase SHA-256 digests, and rejects cyclic, sparse, non-finite, symbol-bearing, or otherwise non-JSON payloads. The typed idempotency service validates printable 1–128 byte keys, calculates injectable 30-day default and explicit 180-day payment retention timestamps, distinguishes `CLAIMED`, `IN_PROGRESS`, `MISMATCH`, `SUCCEEDED`, and `FAILED`, and permits only one terminal transition. The Prisma repository attempts `create` without a preceding read, lets the existing compound unique constraint choose the winner, resolves `P2002` to that winning row, and guards terminal updates with `id + IN_PROGRESS`; focused unit tests cover Prisma error propagation and terminal-state immutability. The idempotency-only unit suite passes 45 tests and scoped coverage is 100% statements, branches, functions, and lines; the exact hash verification command passes 10 tests. The initial Prisma migration was deployed to Supabase and its migration status is current. Against that real PostgreSQL database, the integration suite passes all 22 tests, including 20 rounds of 12 simultaneous claims that each produce exactly one winner and one stored row, plus a concurrent terminal-transition race that preserves retention timestamps. The stress rounds run in batches of four and retain all 240 claim attempts; the complete 165-test suite passes through the Supabase session pooler in about 69 seconds. Timed-out diagnostic rows were removed and no test namespaces remain. Strict typecheck, ESLint, Prettier, and the production build pass. `npm audit` still reports the pre-existing Prisma CLI/configuration findings in `deepmerge-ts` and unused MySQL support (one moderate and four high findings); this slice adds no dependency or lockfile change, so the existing 2026-10-12/CP-32 review gate remains applicable.

**Dependencies:** CP-13  
**Files likely touched:** `wedding-be/src/core/idempotency/request-hash.ts`, `wedding-be/src/core/idempotency/idempotency.repository.ts`, `wedding-be/src/core/idempotency/idempotency.service.ts`, `wedding-be/src/core/idempotency/request-hash.test.ts`, `wedding-be/tests/integration/idempotency-repository.test.ts`  
**Estimated scope:** Medium

### CP-16: Add idempotency HTTP claim and replay behavior

**Description:** Connect the persistence primitive to explicitly marked routes while preserving validation-before-claim and unknown-outcome safety.

**Acceptance criteria:**

- [x] Missing/invalid keys, in-flight duplicates, payload mismatch, and completed replay use documented status/error semantics.
- [x] Two concurrent HTTP requests execute the protected handler once.
- [x] Unknown external outcomes remain reconcilable and are never silently re-executed.

**Verification:**

- [x] `npm run test:integration -- idempotency-http`
- [x] `npm run test:coverage -- idempotency`
- [x] Inspect database state after forced success, deterministic failure, and simulated timeout.

**Implementation evidence (2026-09-30):** Explicit route-level middleware now reads and validates exactly one `Idempotency-Key`, derives a collision-safe namespace from trusted actor scope, HTTP method, normalized route, and operation version, and claims only after the route's request validator has succeeded. The documented contract returns `400 IDEMPOTENCY_KEY_REQUIRED`, `422 INVALID_IDEMPOTENCY_KEY`, `422 IDEMPOTENCY_KEY_REUSED`, or `409 REQUEST_IN_PROGRESS` with `Retry-After` as appropriate. Successful `2xx` and deterministic `4xx` JSON/no-content responses are persisted before transmission and replayed without re-running the handler; replayed standard error envelopes receive the current request ID, while successful domain payloads are left unchanged. `3xx` and `5xx` responses remain `IN_PROGRESS`, so a simulated provider timeout returns `504` once and a retry returns `409` without repeating the external effect. Against the configured Supabase PostgreSQL database through its TLS pooler and existing CA, `npm run test:integration -- idempotency-http` passes six integration files and 28 tests; the CP-16 file directly queries `SUCCEEDED`, `FAILED`, and retained `IN_PROGRESS` rows and proves two concurrent requests execute the handler exactly once. The idempotency coverage run passes 95 tests with 100% statements, branches, functions, and lines; the scope include is supplied because the task's test-name filter otherwise applies per-file thresholds to unrelated source modules. The complete non-database suite passes 188 tests, and strict typecheck, ESLint, Prettier, and the production build pass. One stale CP-16 test row left by an earlier DNS interruption was identified by its exact test namespace and removed. `npm audit` still reports the pre-existing Prisma CLI/configuration findings in `deepmerge-ts` and unused MySQL support (one moderate and four high findings); this slice adds no dependency or lockfile change.

**Dependencies:** CP-11, CP-15  
**Files likely touched:** `wedding-be/src/core/idempotency/idempotency.middleware.ts`, `wedding-be/src/core/idempotency/response-codec.ts`, `wedding-be/src/core/idempotency/idempotency.policy.ts`, `wedding-be/src/app.ts`, `wedding-be/tests/integration/idempotency-http.test.ts`  
**Estimated scope:** Medium

#### Checkpoint C2 — Idempotency

- [x] Atomic winner, replay, mismatch, in-flight, and unknown-outcome scenarios pass.
- [x] No test uses an in-memory substitute for the database concurrency proof.

## Phase D — Contract, Observability, and Security

### CP-17: Generate and verify the OpenAPI 3.1 contract

**Description:** Register Zod route schemas, generate the canonical artifact deterministically, serve it under the configured policy, and add contract checks.

**Acceptance criteria:**

- [x] `openapi/openapi.json` is generated from the same Zod schemas used at runtime.
- [x] Regeneration is byte-stable and `api:check` fails on drift.
- [x] Health, common errors, pagination, request ID, and idempotency components are documented.

**Verification:**

- [x] `npm run api:generate`
- [x] `npm run api:check`
- [x] `npm run test:contract`

**Implementation evidence (2026-09-30):** The backend now generates a canonical OpenAPI 3.1 artifact from the same strict Zod schemas used at runtime for request IDs, common error envelopes, health responses, and idempotency keys. The registry documents liveness/readiness operations plus reusable pagination, request-ID, retry, common-error, and idempotency parameter/response components with schema-valid examples. Generation recursively orders object keys, writes a stable two-space JSON artifact with a final newline, and `api:check` regenerates into an isolated temporary directory before comparing bytes; the contract suite also proves intentional drift is rejected. `/api/v1/openapi.json` serves the exact committed bytes in development, test, and staging, remains disabled by default in production, and is enabled there only with validated `OPENAPI_ENABLED=true`; missing artifacts return the standard non-leaking error envelope. `npm run api:generate`, `npm run api:check`, and all six contract tests pass. Focused CP-17 coverage passes 134 tests at 99.10% lines and 97.64% branches; the complete suite passes all 223 tests, including the PostgreSQL/Supabase persistence and concurrency cases. Strict typecheck, ESLint, Prettier, and the production build pass. `npm audit` still reports the pre-existing Prisma CLI/configuration findings in `deepmerge-ts` and unused MySQL support (one moderate and four high findings); CP-17 adds no dependency or lockfile change.

**Dependencies:** CP-11, CP-12, CP-16  
**Files likely touched:** `wedding-be/src/core/openapi/registry.ts`, `wedding-be/src/core/openapi/generate.ts`, `wedding-be/src/core/openapi/openapi.router.ts`, `wedding-be/openapi/openapi.json`, `wedding-be/tests/contract/openapi.test.ts`  
**Estimated scope:** Medium

### CP-18: Add structured logging, correlation, and redaction

**Description:** Add Pino-based event logs that share request context, use stable fields, name entry points, and prevent secret/PII leakage.

**Acceptance criteria:**

- [x] Production output is structured JSON; local output may use a readable transport.
- [x] Request ID and entry point are present on every request log and provider child logger.
- [x] Redaction tests cover authorization, cookies, tokens, contact data, payment fields, and request bodies.

**Verification:**

- [x] `npm run test:unit -- logging`
- [x] `npm run test:integration -- request-logging`
- [x] Capture an induced error and locate all related events by request ID.

**Implementation evidence (2026-09-30):** The backend now uses pinned Pino 10.3.1 and pino-http 11.0.0 dependencies: production emits newline-delimited JSON with stable event fields, while local development uses the pinned pino-pretty 13.1.3 transport. Request middleware reuses a trusted UUID request ID or generates one, binds `requestId` and the `http` entry point, captures mounted normalized routes before completion, and records bounded method, status class, duration, and error-code fields. Provider child loggers preserve the same correlation context without duplicate JSON keys. An allowlisted request serializer and recursive fail-closed sanitizer exclude request/response bodies and redact authorization, cookies, credentials, tokens, contact data, payment fields, nested errors, circular structures, and unsafe getters. The induced-error integration test locates both the error and completion events by one request ID while proving that the embedded database password is absent. The exact verification commands pass 8 unit tests and 30 integration tests; the complete coverage run passes 236 tests at 98.28% lines and 95.17% branches. Typecheck, ESLint, Prettier, the production build, and `api:check` pass. Registry signature verification covered 425 signatures and 112 attestations, and the new logging packages have MIT licenses and no install scripts. `npm audit` still reports four high-severity findings in the pre-existing Prisma CLI/configuration dependency chain; none is introduced by the Pino packages.

**Dependencies:** CP-09, CP-11  
**Files likely touched:** `wedding-be/src/core/logging/logger.ts`, `wedding-be/src/core/logging/request-logger.ts`, `wedding-be/src/core/logging/redaction.ts`, `wedding-be/src/app.ts`, `wedding-be/src/core/logging/logging.test.ts`  
**Estimated scope:** Medium

#### Checkpoint D1 — Contract and logs

- [x] OpenAPI generation is deterministic and contract tests pass.
- [x] Induced failures are diagnosable by request ID with no secret/PII leakage.

### CP-19: Add RED metrics and optional OpenTelemetry startup

**Description:** Instrument normalized HTTP/provider rate, errors, and duration while keeping labels bounded and tracing entirely optional.

**Acceptance criteria:**

- [x] Histograms support p50/p95/p99 analysis and labels never include raw URLs, IDs, or messages.
- [x] `/internal/metrics` is disabled by default and protected when enabled.
- [x] The process runs normally with no OTLP endpoint and initializes tracing before application imports when configured.

**Verification:**

- [x] `npm run test:unit -- observability`
- [x] `npm run test:integration -- metrics`
- [x] Inspect metric series after successful and failed test requests for bounded labels.

**Implementation evidence (2026-09-30):** Per-application `prom-client` registries now record HTTP and external-provider request counts, error counts, and duration histograms with buckets suitable for `histogram_quantile` p50/p95/p99 queries. HTTP labels are limited to normalized route templates, an allowlisted method (arbitrary values collapse to `OTHER`), and bounded status classes; provider labels use closed module, provider, outcome, and error-kind unions. Success/error integration traffic proves that raw paths, identifiers, query PII, messages, request IDs, and bearer secrets never enter exported series. `/internal/metrics` is absent by default; enabling it requires the validated dedicated bearer token, compares token digests with `timingSafeEqual`, returns the standard error envelope on rejection, disables caching, and remains outside OpenAPI. OpenTelemetry 0.222.0 uses the OTLP HTTP trace exporter plus scoped HTTP/Express auto-instrumentation; the preload registers Node's ESM hook and starts the SDK before `server.ts`, while an absent endpoint loads no hook or SDK. The SDK participates in graceful lifecycle cleanup. Both disabled and configured runtime starts served `/health/live` successfully, and invalid configuration still followed the structured startup-error path. The focused suites pass 9 unit and 3 integration tests; the complete suite passes 248 tests at 98.23% line and 94.56% branch coverage. Typecheck, ESLint, Prettier, production build, and `api:check` pass. All seven new direct telemetry packages are Apache-2.0 and have no dependency lifecycle scripts; registry verification covered 496 signatures and 147 attestations. `npm audit` reports only the four previously documented high findings in the Prisma CLI/configuration chain. npm now marks the spec-mandated `prom-client` 15.1.3 as deprecated in favor of `@prometheus-io/client`; changing that locked architecture requires an approved spec amendment, so no silent migration was made. Re-evaluate that amendment before production launch or by 2026-10-14.

**Dependencies:** CP-10, CP-18  
**Files likely touched:** `wedding-be/src/core/observability/metrics.ts`, `wedding-be/src/core/observability/tracing.ts`, `wedding-be/src/core/observability/metrics.router.ts`, `wedding-be/src/server.ts`, `wedding-be/tests/integration/metrics.test.ts`  
**Estimated scope:** Medium

### CP-20: Apply the HTTP security baseline

**Description:** Configure security headers, explicit CORS, body limits, request deadlines, one-replica rate limits, and consistent security error responses.

**Acceptance criteria:**

- [x] Helmet and CORS settings match environment configuration; wildcard credentialed CORS is impossible.
- [x] JSON/body size, timeout, and general rate-limit failures use the common error envelope.
- [x] Configuration makes the one-process rate-limit limitation explicit and blocks accidental multi-replica claims.

**Verification:**

- [x] `npm run test:integration -- security`
- [x] Inspect response headers and blocked-origin behavior.
- [x] Trigger body-size, timeout, and rate-limit paths and confirm status plus `Retry-After` where applicable.

**Implementation evidence (2026-10-01):** Helmet 8.3.0 now applies its API-safe header baseline on every response, with HSTS enabled only in staging/production. CORS 2.8.6 accepts credentialed browser requests only from the validated exact-origin allowlist, permits origin-less non-browser clients, exposes request/retry correlation headers, and maps rejected origins to the standard `403 CORS_ORIGIN_DENIED` envelope. The bounded JSON parser returns `413 PAYLOAD_TOO_LARGE`, the application deadline returns `408 REQUEST_TIMEOUT`, and express-rate-limit 8.7.0 returns `429 RATE_LIMITED` with `Retry-After`, draft-8 `RateLimit`, and no legacy rate-limit headers. Defaults are 1 MiB, 30 seconds, and 100 requests per 60 seconds; all are bounded startup configuration. `BACKEND_REPLICA_COUNT` accepts only `1`, `.env.example` explains the in-process store, and startup forwards the validated CORS/security settings into the running server. The focused integration command passes 47 tests, the complete suite passes 267 tests, and coverage remains at 98.32% lines and 94.69% branches. Typecheck, ESLint, production build, and `api:check` pass. Registry verification covered 502 signatures and 149 attestations; `npm audit` reports only the four previously documented high findings in the Prisma CLI/configuration chain, whose proposed forced remediation is a breaking Prisma downgrade.

**Dependencies:** CP-09, CP-11, CP-18  
**Files likely touched:** `wedding-be/src/core/http/security.ts`, `wedding-be/src/core/http/rate-limit.ts`, `wedding-be/src/app.ts`, `wedding-be/.env.example`, `wedding-be/tests/integration/security.test.ts`  
**Estimated scope:** Medium

#### Checkpoint D2 — Operable and hardened API

- [x] Contract, logging, metrics, tracing-disabled, and security suites pass together.
- [x] No public response leaks stack traces, SQL details, provider payloads, or secrets.

## Phase E — External Provider Boundaries

### CP-21: Implement the Supabase Storage boundary

**Description:** Define purpose-scoped object operations, an offline fake, a Supabase adapter, signed-read URLs, and defensive response/file validation.

**Acceptance criteria:**

- [x] Callers provide a purpose/resource identity, never an arbitrary bucket/path.
- [x] The adapter persists object keys rather than signed URLs and defaults reads to 15-minute URLs.
- [x] Tests cover success, invalid MIME/content metadata, timeout, missing object, and unsafe key attempts without network calls.

**Verification:**

- [x] `npm run test:unit -- storage-provider`
- [x] `npm run typecheck`
- [x] Search outside `src/integrations/storage` and confirm no Supabase Storage SDK type escapes.

**Implementation evidence (2026-10-01):** The storage boundary now accepts only the closed `PRIVATE_WEDDING_MEDIA` purpose plus a canonical UUID resource identity, generates content-addressed keys under the allowlisted `private-wedding-media/<resourceId>/` prefix, and never accepts a caller-selected bucket or raw provider path. Upload validation allowlists JPEG/PNG/WebP, enforces the 25 MiB platform cap, checks magic bytes, and records SHA-256, MIME, size, purpose, and resource metadata. The offline fake and the pinned `@supabase/storage-js` 2.116.0 adapter share the same interface; the adapter uses the configured private bucket, disables upsert, verifies provider metadata after upload, makes delete idempotent while rejecting mismatched provider identities, normalizes not-found/timeout/unavailable failures, and validates signed URL origin, exact path, token, and bounded lifetime. Only object keys are returned for persistence; read URLs default to 900 seconds. The focused suite passes 24 tests entirely offline with 97.05% statements, 94.33% branches, and 96.96% lines across the selected storage boundary coverage target; the complete suite passes 291 tests. Typecheck, ESLint, Prettier, the production build, `api:check`, and `git diff --check` pass, and the SDK/type escape search has no matches outside `src/integrations/storage`. Registry verification covered 505 signatures and 151 attestations. `npm audit --omit=dev` still reports the four previously documented high findings in the pre-existing Prisma CLI/configuration chain; the new storage dependency chain contains only `iceberg-js` and `tslib` and does not introduce those findings.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/storage/storage-provider.ts`, `wedding-be/src/integrations/storage/storage.schemas.ts`, `wedding-be/src/integrations/storage/fake-storage-provider.ts`, `wedding-be/src/integrations/storage/supabase-storage-provider.ts`, `wedding-be/src/integrations/storage/storage-provider.test.ts`  
**Estimated scope:** Medium

### CP-22: Implement the Resend email boundary

**Description:** Define idempotent transactional email commands, an offline fake, and a Resend adapter with timeouts and normalized failures.

**Acceptance criteria:**

- [x] Every send command requires a deterministic intent idempotency key.
- [x] The adapter validates provider responses and never exposes raw SDK errors to application callers.
- [x] Tests cover success, same-intent retry, mismatched payload, provider conflict, timeout, and transient failure offline.

**Verification:**

- [x] `npm run test:unit -- email-provider`
- [x] `npm run typecheck`
- [x] Search outside `src/integrations/email` and confirm no Resend SDK type escapes.

**Implementation evidence (2026-10-01):** The email boundary now requires a branded `<event-type>/<persisted-UUID>` intent key, accepts only bounded transactional recipient/subject/text/optional-HTML fields, sources the sender exclusively from validated configuration, and rejects unknown fields plus CR/LF header-injection attempts. The offline fake hashes payloads, replays the original result for same-intent retries, and rejects key reuse with a different payload without retaining recipient addresses or message bodies. The pinned Resend 6.31.0 adapter passes the key through the SDK's documented request options, validates every returned shape and provider message UUID, applies a bounded timeout, maps payload mismatch and concurrent requests to stable idempotency errors, and normalizes timeout, rate-limit, transient, malformed, permanent, and thrown failures without exposing raw SDK details. The focused suite passes 18 tests offline with 98.94% statements, 97.26% branches, 100% functions, and 98.93% lines across the selected email boundary coverage target; the complete suite passes 309 tests. Typecheck, ESLint, Prettier, the production build, `api:check`, `git diff --check`, a clean `npm ci --ignore-scripts`, and the SDK-import escape search pass. Registry verification covered 510 signatures and 154 attestations. `npm audit --omit=dev` still reports the four previously documented high findings in the pre-existing Prisma CLI/configuration chain; the new Resend dependency chain contains only `postal-mime` and `standardwebhooks` and does not introduce those findings. No live or billable Resend request was made.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/email/email-provider.ts`, `wedding-be/src/integrations/email/email.schemas.ts`, `wedding-be/src/integrations/email/fake-email-provider.ts`, `wedding-be/src/integrations/email/resend-email-provider.ts`, `wedding-be/src/integrations/email/email-provider.test.ts`  
**Estimated scope:** Medium

### CP-23: Implement the Gemini AI image boundary

**Description:** Define safe image-generation commands, an offline fake, and a Gemini adapter with configurable model, resource caps, and untrusted-output validation.

**Acceptance criteria:**

- [x] No caller sends guest, payment, authentication, or unrelated PII through the contract.
- [x] Returned images are validated for schema, MIME, dimensions, and byte size before acceptance.
- [x] Tests cover success, safety refusal, invalid output, timeout, quota/transient failure, and disabled provider offline.

**Verification:**

- [x] `npm run test:unit -- ai-image-provider`
- [x] `npm run typecheck`
- [x] Search outside `src/integrations/ai-image` and confirm no Gemini SDK type escapes.

**Implementation evidence (2026-10-01):** The AI image boundary now accepts only a bounded creative prompt and allowlisted aspect ratio, rejects unknown fields plus recognizable contact, payment, auth-token, and entity-identifier patterns, and exposes no guest, booking, payment, authentication, storage-path, or tool-call fields. The offline fake returns a deterministic validated PNG, while the disabled provider fails closed without constructing an SDK client or issuing network traffic. The pinned `@google/genai` 2.24.0 adapter keeps the configured model and all SDK types local, requests exactly one image with no tools, disables automatic retries for the potentially billable operation, applies SDK and outer abort timeouts, and validates the complete response path before decoding strict base64. Accepted output is restricted to PNG signature/IHDR data, 10 MiB, 4096 pixels per dimension, and 16,777,216 total pixels; safety refusals, invalid output, timeout, quota/transient, and permanent failures map to stable errors without raw SDK details. The focused suite passes 25 tests offline with 92.24% statements, 86.95% branches, 96.66% functions, and 92.06% lines across the selected AI image boundary target; all three provider suites pass 67 tests and the complete suite passes 334 tests at 97.54% line and 93.83% branch coverage. Typecheck, ESLint, Prettier, the production build, `api:check`, `git diff --check`, a clean `npm ci --ignore-scripts`, and the SDK-import escape search pass. Registry verification covered 536 signatures and 155 attestations. `npm audit --omit=dev` still reports only the four previously documented high findings in the pre-existing Prisma CLI/configuration chain; the new Gemini dependency chain introduces none of those findings. No live, billable, or externally mutating Gemini request was made.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/ai-image/ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/ai-image.schemas.ts`, `wedding-be/src/integrations/ai-image/fake-ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/gemini-ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/ai-image-provider.test.ts`  
**Estimated scope:** Medium

#### Checkpoint E — Provider isolation

- [x] All provider tests pass with network disabled.
- [x] SDK imports/types remain adapter-local and provider logs pass redaction checks.
- [x] No billable call or external mutation occurred.

## Phase F — Typed API Clients

### CP-24: Connect Public Web to the generated API contract

**Description:** Generate the Public Web schema from an immutable backend artifact and create one typed fetch wrapper with normalized errors, timeout, base URL, and request ID behavior.

**Acceptance criteria:**

- [x] Generated declarations include source digest metadata and are never hand-edited.
- [x] `api:check` fails on intentional drift and accepts the canonical artifact.
- [x] Wrapper tests cover successful data, structured API errors, malformed responses, and timeout.

**Verification:**

- [x] `npm run api:generate`
- [x] `npm run api:check`
- [x] `npm run test:unit -- api-client`

**Implementation evidence (2026-10-01):** Public Web now locks the canonical backend OpenAPI artifact from commit `2726eaa2b316da00890a73066610186a12967a36` at SHA-256 `eaf954a667801edcf94ba1db7c11a442d88a55b99de8c9020d6ac2675be76d8f`. Its deterministic generator validates that digest before producing the committed, immutable, Prettier-stable declaration header and body; an intentional one-line declaration drift made `api:check` fail before regeneration restored a clean check. The single `openapi-fetch` wrapper applies the validated public base URL, per-request UUID correlation, bounded timeout and caller-abort propagation, and normalized structured API, malformed-response, network, abort, and timeout errors without exposing raw transport messages. The focused acceptance suite passes 10 tests. The complete 16-test coverage suite passes with `client.ts` at 94.91% line and 89.74% branch coverage. Strict typecheck, ESLint, Prettier, deterministic API verification, and the Next.js production build pass.

**Dependencies:** CP-03, CP-04, CP-17  
**Files likely touched:** `wedding-web/scripts/generate-api.mjs`, `wedding-web/api-contract.lock.json`, `wedding-web/src/lib/api/generated/schema.d.ts`, `wedding-web/src/lib/api/client.ts`, `wedding-web/src/lib/api/client.test.ts`  
**Estimated scope:** Medium

### CP-25: Connect Management Web to the generated API contract

**Description:** Apply the same immutable contract and typed wrapper pattern independently in `wedding-manage-web`.

**Acceptance criteria:**

- [x] The digest matches Public Web for the same backend contract.
- [x] No Manager/Staff authorization decision is implemented in the wrapper.
- [x] Success, structured errors, malformed responses, and timeout are tested.

**Verification:**

- [x] `npm run api:generate`
- [x] `npm run api:check`
- [x] `npm run test:unit -- api-client`

**Implementation evidence (2026-10-02):** Management Web now locks the same canonical backend OpenAPI artifact and SHA-256 digest as Public Web (`eaf954a667801edcf94ba1db7c11a442d88a55b99de8c9020d6ac2675be76d8f`). Its deterministic generator rejects an intentional declaration drift and restores the committed schema through regeneration. The repo-local `openapi-fetch` wrapper applies the validated public base URL, per-request UUID correlation, bounded timeout and caller-abort propagation, and normalized structured API, malformed-response, network, abort, and timeout errors without making Manager/Staff authorization decisions. The focused acceptance suite passes 10 tests; the complete 16-test coverage suite passes with `client.ts` at 94.91% line and 89.74% branch coverage. Strict typecheck, ESLint, Prettier, deterministic API verification, and the Next.js production build pass. The implementation is recorded in Management Web commits `962a80f` and `fbd7368`.

**Dependencies:** CP-05, CP-06, CP-17  
**Files likely touched:** `wedding-manage-web/scripts/generate-api.mjs`, `wedding-manage-web/api-contract.lock.json`, `wedding-manage-web/src/lib/api/generated/schema.d.ts`, `wedding-manage-web/src/lib/api/client.ts`, `wedding-manage-web/src/lib/api/client.test.ts`  
**Estimated scope:** Medium

### CP-26: Connect Expo to the generated API contract and prepare EAS

**Description:** Generate Expo API types, implement an abortable React Native fetch wrapper, and add an Android preview EAS profile without running a cloud build.

**Acceptance criteria:**

- [x] Contract digest matches both web clients.
- [x] The client handles offline/network timeout separately from structured API errors and contains no auth storage policy yet.
- [x] `eas.json` contains a valid Android preview profile and no credential material.

**Verification:**

- [x] `npm run api:generate && npm run api:check`
- [x] `npm run test -- api-client`
- [x] `npx expo-doctor`

**Implementation evidence (2026-10-02):** Expo now locks and deterministically generates from the same canonical backend OpenAPI artifact and SHA-256 digest as both web clients (`eaf954a667801edcf94ba1db7c11a442d88a55b99de8c9020d6ac2675be76d8f`). Its repo-local `openapi-fetch` wrapper uses `expo/fetch`, Expo-native UUID generation, validated public configuration, request correlation, bounded timeout, caller-abort propagation, and distinct structured API, malformed-response, offline/network, abort, and timeout errors without introducing token storage or authorization policy. The Android-only EAS `preview` profile is pinned to EAS CLI 23.2.0 and produces an internally distributed APK without committed credential material; no cloud build was run. The focused suite passes 10 tests, the complete 11-test coverage suite passes with `client.ts` at 94.82% line and 89.74% branch coverage, Expo Doctor passes all 21 checks, and strict typecheck, ESLint, Prettier, deterministic API verification, high/critical production audit, and Android production export pass. The implementation is recorded in Expo commits `a234b3d` and `01aa813`.

**Dependencies:** CP-07, CP-08, CP-17  
**Files likely touched:** `wedding-app/scripts/generate-api.mjs`, `wedding-app/api-contract.lock.json`, `wedding-app/src/lib/api/generated/schema.d.ts`, `wedding-app/src/lib/api/client.ts`, `wedding-app/eas.json`  
**Estimated scope:** Medium

#### Checkpoint F — Cross-repository contract

- [x] All three generated schema files identify the same backend artifact digest.
- [x] Every client `api:check`, test, typecheck, and build passes.
- [x] No client imports backend source or contains provider service secrets.

## Phase G — CI, Documentation, and Acceptance

### CP-27: Add backend CI with PostgreSQL integration gates

**Description:** Create a GitHub Actions pipeline for static gates, unit/contract tests, PostgreSQL migration/integration tests, build, and dependency audit.

**Acceptance criteria:**

- [x] Pull requests and pushes to `main` run Node 24 with `npm ci`.
- [x] A disposable PostgreSQL service runs migration and integration suites with test-only credentials.
- [x] Failures block the job; no test, audit, or migration gate is marked continue-on-error.

**Verification:**

- [x] Validate workflow syntax.
- [x] Run all workflow commands locally or in an equivalent clean environment.
- [x] Confirm artifacts/logs contain no secrets.

**Implementation evidence (2026-10-02):** Backend CI now runs two independent, ten-minute GitHub Actions jobs for every pull request and push to `main`, using the committed Node 24 version, `npm ci`, npm caching, read-only repository permissions, and SHA-pinned official checkout/setup actions. The quality job gates formatting, lint, strict typecheck, unit and contract suites, deterministic OpenAPI verification, bounded-worker coverage, production build, and a fail-closed high/critical dependency audit. The audit policy accepts only the two current Prisma 7.10 transitive advisories after exact identity matching and documented reachability, mitigation, owner, and a mandatory 2026-10-16 review date; malformed reports, new advisories, mismatches, and expired exceptions fail the job. The PostgreSQL job uses an isolated PostgreSQL 17 service with test-only credentials, health checks, a clean migration deploy, and the complete integration suite; no production secret or `continue-on-error` is present. Dependabot separately tracks npm and GitHub Actions weekly. Prettier parsed both YAML files, the CI contract suite passes 13 tests, a clean `npm ci` and Prisma generation succeed, and format, ESLint, typecheck, OpenAPI, build, and the real audit gate pass. Unit tests pass 286/286; a clean no-`.env` coverage run passes 329 tests with 13 database tests intentionally skipped at 97.54% line and 93.83% branch coverage. Against a disposable local PostgreSQL 17 container, the initial migration applies from empty and all 43 integration tests pass; the container was then stopped and removed. No artifact upload is configured, and the inspected output contains no credential value beyond the explicitly non-secret disposable test account.

**Dependencies:** CP-13 through CP-23  
**Files likely touched:** `wedding-be/.github/workflows/ci.yml`, `wedding-be/.github/dependabot.yml`, `wedding-be/package.json`  
**Estimated scope:** Medium

### CP-28: Add Public Web CI and immutable contract verification

**Description:** Gate Public Web changes on static quality, tests, production build, audit, and an OpenAPI artifact matching its lock metadata.

**Acceptance criteria:**

- [x] PR/main events use Node 24 and `npm ci`.
- [x] Contract verification uses an exact backend commit/release artifact, never a moving branch.
- [x] Lint, typecheck, coverage, build, API check, and high-severity audit failures block merge.

**Verification:**

- [x] Validate workflow syntax.
- [x] Run the exact workflow commands locally.
- [x] Intentionally alter the digest in a local copy and confirm contract verification fails.

**Implementation evidence (2026-10-02):** Public Web CI now runs one bounded ten-minute quality job for every pull request and push to `main`, using the committed Node 24 version, `npm ci`, npm caching, read-only repository permissions, and SHA-pinned official checkout/setup actions. Formatting, ESLint, strict typecheck, coverage, production build, immutable API verification, and a high-severity dependency audit all fail closed with no `continue-on-error`. The contract step validates the lock as a GitHub HTTPS repository plus an exact 40-character commit and traversal-safe artifact path, downloads that exact private artifact with an optional fine-grained read-only `BACKEND_CONTRACT_READ_TOKEN`, refuses redirects, and then verifies both the locked SHA-256 digest and committed generated schema. Dependabot tracks npm and GitHub Actions weekly. Prettier parsed both workflow files; the exact clean install succeeds with 304 packages and zero vulnerabilities; lint and typecheck pass; all 16 tests pass at 95.58% line and 90.9% branch coverage; the Next.js production build succeeds; the authenticated remote artifact passes `api:check`; and replacing the digest with zeros in an isolated local copy fails with the expected digest mismatch. The workflow logs no token or production secret, and the inspected diff contains no credential value.

**Dependencies:** CP-24  
**Files likely touched:** `wedding-web/.github/workflows/ci.yml`, `wedding-web/.github/dependabot.yml`  
**Estimated scope:** Small

#### Checkpoint G1 — Backend and Public Web CI

- [ ] Both workflows contain every required gate and use no production secrets.
- [ ] Expected runtime is under 10 minutes or an optimization note is recorded.

### CP-29: Add Management Web CI and immutable contract verification

**Description:** Apply the same independent quality and immutable-contract gates to the Manager/Staff repository.

**Acceptance criteria:**

- [x] PR/main events use Node 24 and `npm ci`.
- [x] Contract digest/source verification is identical in meaning to Public Web.
- [x] All required gates block failures.

**Verification:**

- [x] Validate workflow syntax.
- [x] Run the exact workflow commands locally.
- [x] Confirm an intentional contract mismatch fails.

**Implementation evidence (2026-10-02):** Management Web CI now runs one bounded ten-minute quality job for every pull request and push to `main`, using the committed Node 24 version, `npm ci`, npm caching, read-only repository permissions, and SHA-pinned official checkout/setup actions. Formatting, ESLint, strict typecheck, single-worker coverage, production build, immutable API verification, and a high-severity dependency audit all fail closed with no `continue-on-error`. Its contract gate is identical in meaning to Public Web: it validates a GitHub HTTPS source, exact 40-character backend commit, and traversal-safe path from the lock, uses the optional fine-grained read-only `BACKEND_CONTRACT_READ_TOKEN` for private access, refuses redirects, and verifies both the SHA-256 digest and committed generated schema. Dependabot tracks npm and GitHub Actions weekly. Prettier parsed both workflow files; the exact clean install succeeds with 304 packages and zero vulnerabilities; lint and typecheck pass; all 16 tests pass at 95.58% line and 90.9% branch coverage; the Next.js production build succeeds; the authenticated remote artifact passes `api:check`; and replacing the digest with zeros in an isolated local copy fails with the expected digest mismatch. Coverage uses one worker because two concurrent Windows fork workers exceeded their startup timeout locally, while the same complete suite passes in 27.64 seconds with one worker—well below the ten-minute job budget. GitHub PR #7 then exercised the private repository token in run `36975325291` attempt 2: contract download, coverage, build, and audit all completed successfully, and the PR is cleanly mergeable. No token value, production secret, dependency, or lockfile change is included.

**Dependencies:** CP-25  
**Files likely touched:** `wedding-manage-web/.github/workflows/ci.yml`, `wedding-manage-web/.github/dependabot.yml`  
**Estimated scope:** Small

### CP-30: Add Expo CI quality gates

**Description:** Gate Expo changes on SDK health, lint, types, Jest coverage, Android JS export/build, contract check, and dependency audit without consuming EAS cloud build capacity.

**Acceptance criteria:**

- [x] PR/main events use Node 24 and `npm ci`.
- [x] `expo-doctor`, contract verification, tests, and Android export run without EAS credentials.
- [x] EAS cloud build remains manual/later and is not silently triggered by CI.

**Verification:**

- [x] Validate workflow syntax.
- [x] Run the exact workflow commands locally.
- [x] Confirm the workflow contains no signing or service-account material.

**Implementation evidence (2026-10-02):** Expo CI now runs one bounded ten-minute quality job for every pull request and push to `main`, using the committed Node 24 version, `npm ci`, npm caching, read-only repository permissions, disabled Expo telemetry, and SHA-pinned official checkout/setup actions. The job fails closed on a pinned `expo-doctor`, formatting, ESLint, strict typecheck, immutable API verification, in-band Jest coverage, Android JavaScript export, and a critical-severity dependency audit; it contains no `continue-on-error`, EAS build/update/submit command, EAS token, signing key, credential file, or service-account material. The contract gate validates an immutable GitHub HTTPS source, exact 40-character backend commit, and traversal-safe path before downloading with the optional fine-grained read-only `BACKEND_CONTRACT_READ_TOKEN`, then verifies both the SHA-256 digest and committed generated schema. Dependabot tracks npm and GitHub Actions weekly. Both workflow files parse as valid YAML and pass Prettier; the clean install added 1,097 packages; `expo-doctor` passed all 21 checks; lint and typecheck pass; all 11 tests pass at 95% line and 89.74% branch coverage; the Android export succeeds; and substituting `package.json` as the contract source fails with the expected digest mismatch. The audit threshold is critical because the current Expo SDK 57 dependency graph reports four high-severity transitive `node-forge` findings for which npm offers only a breaking downgrade to Expo 44; those known findings remain visible in every audit and are tracked by weekly dependency updates rather than being hidden or bypassed. No dependency, lockfile, application source, cloud build, or signing configuration changed.

**Dependencies:** CP-26  
**Files likely touched:** `wedding-app/.github/workflows/ci.yml`, `wedding-app/.github/dependabot.yml`  
**Estimated scope:** Small

#### Checkpoint G2 — All repository CI

- [ ] Four independent CI workflows pass from clean installs.
- [ ] No gate is skipped or configured as non-blocking.
- [ ] Dependency update automation is weekly and bounded.

### CP-31: Document the four-repository developer workflow

**Description:** Add concise repository-specific setup and a backend-owned cross-repository guide covering commands, environment placeholders, contract updates, migrations, and offline providers.

**Acceptance criteria:**

- [ ] A new developer can identify which repository owns each responsibility and start each project without tribal knowledge.
- [ ] Documentation distinguishes runtime versus migration database URLs and immutable OpenAPI artifact flow.
- [ ] Secret handling, fake-provider testing, Android/EAS boundary, and common troubleshooting are explicit.

**Verification:**

- [ ] Follow each README from a clean checkout using placeholder/test configuration.
- [ ] Check every documented command against `package.json`.
- [ ] Confirm no example contains a real credential or usable production identifier.

**Dependencies:** CP-24 through CP-30  
**Files likely touched:** `wedding-be/README.md`, `wedding-be/docs/cross-repo-development.md`, `wedding-web/README.md`, `wedding-manage-web/README.md`, `wedding-app/README.md`  
**Estimated scope:** Medium

### CP-32: Run and record the final `core-platform` acceptance audit

**Description:** Execute all repository gates from clean installs, map evidence to the 12 approved success criteria, and record any explicitly deferred live-environment checks.

**Acceptance criteria:**

- [ ] Every success criterion in `SPEC-core-platform.md` has command/test/file evidence or an owner-approved external-input deferral.
- [ ] All four working trees contain only intended source/config/generated artifacts and no secrets/build outputs.
- [ ] The capability is ready for project-owner review before beginning `identity-access`.

**Verification:**

- [ ] Run every command in the plan's Verification Model in its owning repository.
- [ ] Review dependency-audit findings for reachability and document any time-bounded exception.
- [ ] Review cross-repository diffs and contract digests, then save the evidence report.

**Dependencies:** CP-27, CP-28, CP-29, CP-30, CP-31  
**Files likely touched:** `wedding-be/tasks/evidence/core-platform.md`, `wedding-be/tasks/todo.md`  
**Estimated scope:** Small

#### Checkpoint G3 — Capability complete

- [ ] All 32 tasks and all checkpoints are complete.
- [ ] Project owner reviews the evidence and approves `core-platform` implementation.
- [ ] No work on `identity-access` starts before that approval.

## Phase H — Post-Core Module Specification and Planning Gates

The tasks below are documentation and planning gates, not authorization to implement the named module. Completing a gate adds the module's detailed vertical implementation tasks to this file. Those new tasks must be completed and the module implementation approved before the next provider-dependent specification gate begins.

### SPEC-01: Specify `identity-access`

**Description:** Convert the approved access requirements into the module specification, fix the prospect/Couple entitlement model and provider contracts, and expand this rolling plan with small implementation slices.

**Acceptance criteria:**

- [ ] `SPEC-identity-access.md` covers ACC-002 through ACC-007, authentication/session behavior, restricted prospect entitlements, access promotion, privacy/retention, and failure states.
- [ ] Invitation bootstrap, revocation, authorization, and post-deposit promotion contracts have explicit state transitions and concurrency/security tests.
- [ ] Detailed implementation tasks and checkpoints are inserted into `plan.md` and `todo.md`, then approved by the project owner before code starts.

**Verification:**

- [ ] Trace ACC-002 through ACC-007 to spec acceptance criteria and planned automated tests.
- [ ] Review the provider boundary needed by `booking-lifecycle` without introducing a reverse dependency.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** CP-32 and project-owner approval of the `core-platform` implementation.

**Files likely touched:** `wedding-be/SPEC-identity-access.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H1 — Identity specification ready

- [ ] Project owner approves the identity-access spec and detailed implementation slice.
- [ ] No identity implementation begins from product requirements alone.

### SPEC-02: Specify `venue-catalog`

**Description:** Specify the restaurant catalog together with versioned timeline templates and immutable fixed-layout templates, then add its vertical implementation tasks.

**Acceptance criteria:**

- [ ] `SPEC-venue-catalog.md` covers the existing restaurant/hall/menu scope plus SEA-001 and SEA-002.
- [ ] Template versioning, capacity ranges, stable table identities, retirement behavior, Manager permissions, and historical-reference preservation are explicit.
- [ ] Detailed backend and Management Web slices with migration, API, seed, and verification tasks are approved before implementation.

**Verification:**

- [ ] Trace SEA-001 and SEA-002 to acceptance criteria and tests.
- [ ] Confirm layout geometry remains restaurant-owned and cannot be mutated through Couple contracts.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `identity-access` implementation.

**Files likely touched:** `wedding-be/SPEC-venue-catalog.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-03: Specify `booking-lifecycle`

**Description:** Specify consultation workspaces, versioned timeline collaboration, dual approval, deposit eligibility, and post-deposit change requests before adding implementation slices.

**Acceptance criteria:**

- [ ] `SPEC-booking-lifecycle.md` covers ACC-001 and TML-001 through TML-008 together with availability, holds, booking states, change, and cancellation rules.
- [ ] Timeline revision/approval transitions and the authoritative deposit-eligibility contract handle stale clients and edit/approval races.
- [ ] Detailed backend, Public Web, and Management Web vertical slices are approved with migration, API, concurrency, audit, and UI verification.

**Verification:**

- [ ] Trace ACC-001 and TML-001 through TML-008 to acceptance criteria and tests.
- [ ] Review the identity, catalog, and future payment interfaces for acyclic ownership.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `venue-catalog` implementation.

**Files likely touched:** `wedding-be/SPEC-booking-lifecycle.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H2 — Consultation and catalog planning ready

- [ ] Venue and booking specifications have approved provider contracts and detailed task slices.
- [ ] Deposit remains impossible to plan as a client-only or stale-state decision.

### SPEC-04: Specify `payments-billing`

**Description:** Specify deposit, manual/VNPay payment, balance, invoice, refund, and accepted print-charge accounting with idempotent money transitions.

**Acceptance criteria:**

- [ ] `SPEC-payments-billing.md` covers the existing payment scope and PRN-006.
- [ ] Deposit eligibility recheck, print-charge registration, receivable inclusion, idempotency, reconciliation, and refund boundaries are explicit.
- [ ] Detailed implementation tasks cover database constraints, provider callbacks, audit evidence, API contracts, and Manager/Couple billing views.

**Verification:**

- [ ] Trace PRN-006 and all payment state transitions to automated tests, including concurrency and callback replay.
- [ ] Confirm `invitation-studio` can register an accepted charge without owning billing state.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `booking-lifecycle` implementation.

**Files likely touched:** `wedding-be/SPEC-payments-billing.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-05: Specify `invitation-studio`

**Description:** Specify invitation designs, private wedding media, the generic public QR, immutable printable revisions, quotation approval, and print fulfillment before adding vertical slices.

**Acceptance criteria:**

- [ ] `SPEC-invitation-studio.md` covers MED-001 through MED-006, PRN-001 through PRN-005, PRN-007 through PRN-009, and QRC-001 through QRC-004.
- [ ] Media authorization/retention, printable/commercial snapshotting, print state transitions, billing calls, and public/private asset separation are explicit.
- [ ] Detailed backend, Public Web, Couple App, and Management Web tasks are approved with storage, security, contract, and print-race tests.

**Verification:**

- [ ] Trace every owned MED, PRN, and QRC requirement to acceptance criteria and automated tests.
- [ ] Prove the generic QR cannot reveal private media, personalized guest data, RSVP identity, or a check-in mutation.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `payments-billing` implementation.

**Files likely touched:** `wedding-be/SPEC-invitation-studio.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H3 — Commercial and invitation planning ready

- [ ] Payment and invitation specs preserve one-way billing ownership and immutable approved print content.
- [ ] Private media and public invitation assets have separate authorization and storage purposes.

### SPEC-06: Specify `guest-rsvp`

**Description:** Specify invitation households, default/custom guest groups, personalized electronic invitations, delivery, RSVP, and expected headcount.

**Acceptance criteria:**

- [ ] `SPEC-guest-rsvp.md` covers GST-001 through GST-008 and QRC-005.
- [ ] Household identity, optional disambiguating contact, companion counts, group lifecycle, token privacy, and personalized-link behavior are explicit.
- [ ] Detailed backend and Guest/Couple Web tasks are approved with import, normalization, authorization, delivery, and RSVP tests.

**Verification:**

- [ ] Trace GST-001 through GST-008 and QRC-005 to acceptance criteria and tests.
- [ ] Confirm guest-group identifiers are stable provider-owned contracts for seating, staff operations, and analytics.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `invitation-studio` implementation.

**Files likely touched:** `wedding-be/SPEC-guest-rsvp.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-07: Specify `seating-plan`

**Description:** Specify capacity-compatible fixed-layout selection and table-level guest-group labeling without per-guest seating or editable geometry.

**Acceptance criteria:**

- [ ] `SPEC-seating-plan.md` covers SEA-003 through SEA-008.
- [ ] Layout selection, label mapping, headcount invalidation, Manager exception, remapping, confirmation, and audit transitions are explicit.
- [ ] Detailed backend and Couple/Manager client slices are approved with compatibility, stale-template, authorization, and remapping tests.

**Verification:**

- [ ] Trace SEA-003 through SEA-008 to acceptance criteria and tests.
- [ ] Search the planned contracts for prohibited individual `SeatAssignment` or Couple geometry mutations.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `guest-rsvp` implementation.

**Files likely touched:** `wedding-be/SPEC-seating-plan.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-08: Specify `staff-operations`

**Description:** Specify event assignments, household lookup, multi-arrival check-in, over-expected warnings, group guidance, and audited corrections.

**Acceptance criteria:**

- [ ] `SPEC-staff-operations.md` covers CHK-001 through CHK-008 and staff assignment/authorization.
- [ ] Arrival, correction, cumulative attendance, duplicate-name handling, concurrency, and audit state are explicit.
- [ ] Detailed backend and Staff Web slices are approved with simultaneous-arrival, warning, correction, privacy, and authorization tests.

**Verification:**

- [ ] Trace CHK-001 through CHK-008 to acceptance criteria and tests.
- [ ] Confirm actual attendance derives from auditable arrivals/corrections and never from QR or per-seat occupancy.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `seating-plan` implementation.

**Files likely touched:** `wedding-be/SPEC-staff-operations.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H4 — Guest planning and event operations ready

- [ ] Guest, seating, and staff specs use one stable guest-group identity with acyclic dependencies.
- [ ] End-to-end test plans cover group creation through table labeling and multi-arrival guidance.

### SPEC-09: Specify `notifications-automation`

**Description:** Specify safe delivery of workspace, timeline, payment, print, RSVP, reminder, and completion events plus bounded background-job behavior.

**Acceptance criteria:**

- [ ] `SPEC-notifications-automation.md` covers OPS-001 and OPS-002 with the existing notification/job scope.
- [ ] Event ownership, deduplication, retries, deadlines, quiet failure behavior, redaction, and recipient preferences are explicit.
- [ ] Detailed backend and client notification tasks are approved with fake-provider, replay, scheduling, and PII-leak tests.

**Verification:**

- [ ] Trace OPS-001 and OPS-002 to acceptance criteria and tests.
- [ ] Confirm notifications consume provider events without becoming the source of booking, payment, print, or RSVP truth.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `staff-operations` implementation.

**Files likely touched:** `wedding-be/SPEC-notifications-automation.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-10: Specify `analytics-dashboard`

**Description:** Specify restaurant KPIs, receivables, booking/hall/menu reporting, print fulfillment, and grouped expected-versus-actual attendance.

**Acceptance criteria:**

- [ ] `SPEC-analytics-dashboard.md` covers OPS-003 and OPS-004 with the existing dashboard scope.
- [ ] Metric definitions, filters, time zone, source-of-truth fields, draft/accepted print treatment, privacy, and refresh behavior are explicit.
- [ ] Detailed backend and Management Web slices are approved with fixture-based query, aggregation, authorization, and display tests.

**Verification:**

- [ ] Trace OPS-003 and OPS-004 to acceptance criteria and tests.
- [ ] Confirm reports do not infer per-seat occupancy and exclude draft print quotations from receivables.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `notifications-automation` implementation.

**Files likely touched:** `wedding-be/SPEC-analytics-dashboard.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-11: Specify `release-demo`

**Description:** Specify the production-minded demo release, seeded end-to-end journey, deployment, Android preview artifact, observability, rollback, and evidence package.

**Acceptance criteria:**

- [ ] `SPEC-release-demo.md` covers the complete approved capability map and cross-module scenarios from `PRODUCT-REQUIREMENTS.md`.
- [ ] Deployment ownership, environment configuration, seed data, migration order, rollback, monitoring, security review, and demo script are explicit.
- [ ] Detailed release tasks and go/no-go checkpoints are approved without weakening any module's Definition of Done.

**Verification:**

- [ ] Map every capability and cross-module acceptance scenario to a release check or evidence artifact.
- [ ] Review deployment and rollback dependencies across all four repositories.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Approved and completed `analytics-dashboard` implementation.

**Files likely touched:** `wedding-be/SPEC-release-demo.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H5 — Program specification sequence complete

- [ ] All module specs, detailed task slices, implementations, and evidence approvals are complete in dependency order.
- [ ] Release planning covers the restricted-workspace-to-event-check-in journey and all four repositories.
- [ ] No deferred or out-of-scope feature was silently promoted into the required release.

## Rolling-Plan Rule

When a SPEC task is approved, insert that module's implementation tasks immediately after its specification gate and before the next dependent SPEC task. Update the dependent SPEC task to reference the final implementation/evidence task IDs. Never mark a SPEC task complete merely because a draft exists; approval and detailed task insertion are required.
