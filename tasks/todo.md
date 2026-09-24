# Task List: `core-platform`

Status: Approved by project owner on 2026-09-24  
Plan: [`plan.md`](./plan.md)  
Specification: [`../SPEC-core-platform.md`](../SPEC-core-platform.md)

## Working Rules

- Complete tasks in dependency order; tasks explicitly marked parallel may use separate repository branches/sessions.
- A task is complete only when every acceptance and verification checkbox is satisfied.
- Keep human-authored scope to approximately five files. Framework-generated scaffold files are the only documented exception and must be reviewed as a single generated change.
- Update the approved spec before changing a locked architecture decision.
- Do not use live Supabase, Resend, Gemini, or EAS credentials in automated tests.
- Commit each verified task or tightly coupled task pair as an atomic save point in its owning repository.

## Phase A — Reproducible Repository Foundations

### CP-01: Establish the backend package and compiler baseline

**Description:** Create the Node 24/npm/TypeScript foundation for `wedding-be`, pin the approved backend dependencies, and expose the common script names required by the spec.

**Acceptance criteria:**

- [ ] `package.json` pins Node 24, npm, TypeScript 5.9.3, Express 5.2.1, Prisma 7.10.0, and the approved core dependencies without preview tags.
- [ ] ESM and strict compiler options are configured for development and production output.
- [ ] A clean install produces exactly one committed npm lockfile.

**Verification:**

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] Inspect `npm ls --depth=0` for unexpected major versions.

**Dependencies:** None  
**Files likely touched:** `wedding-be/package.json`, `wedding-be/package-lock.json`, `wedding-be/.node-version`, `wedding-be/tsconfig.json`, `wedding-be/tsconfig.build.json`  
**Estimated scope:** Medium

### CP-02: Add backend lint, formatting, and unit-test harness

**Description:** Add flat ESLint, Prettier, Vitest 5, coverage configuration, safe ignores, and a first smoke test so quality commands are real from the start.

**Acceptance criteria:**

- [ ] ESLint uses flat config and TypeScript-aware rules; Prettier is the only formatter.
- [ ] Vitest runs in Node mode and enforces the approved core coverage thresholds.
- [ ] Secrets, dependencies, build output, reports, and local environment files are ignored.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm run test:coverage`
- [ ] `npm run build`

**Dependencies:** CP-01  
**Files likely touched:** `wedding-be/eslint.config.mjs`, `wedding-be/prettier.config.mjs`, `wedding-be/vitest.config.ts`, `wedding-be/src/core/smoke.test.ts`, `wedding-be/.gitignore`  
**Estimated scope:** Medium

#### Checkpoint A1 — Backend toolchain

- [ ] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [ ] No secrets or build outputs appear in `git status`.

### CP-03: Establish the Public Web Next.js baseline

**Description:** Scaffold `wedding-web` with Next.js 16.3.6 App Router, React 19.2.3, strict TypeScript, npm, and API-contract dependencies.

**Acceptance criteria:**

- [ ] The repository uses App Router and contains no backend/database dependency.
- [ ] Node, TypeScript, Next.js, React, lint/test, and API-client packages are pinned to approved stable lines.
- [ ] Public environment parsing recognizes only non-secret public configuration.

**Verification:**

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm ls next react react-dom typescript`

**Dependencies:** None; may run in parallel with CP-01, CP-05, and CP-07.  
**Files likely touched:** framework-generated Next.js configuration set plus `wedding-web/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-04: Add the Public Web shell and quality harness

**Description:** Create a minimal Public/Guest/Couple route-group shell and prove that lint, tests, and a production build work without adding product UI.

**Acceptance criteria:**

- [ ] The root route renders a neutral foundation page and route groups exist without business screens.
- [ ] Vitest/Testing Library has one rendering smoke test.
- [ ] ESLint, formatting, test, and build scripts match the shared command contract.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm run test:coverage`
- [ ] `npm run build`

**Dependencies:** CP-03  
**Files likely touched:** `wedding-web/app/layout.tsx`, `wedding-web/app/page.tsx`, `wedding-web/eslint.config.mjs`, `wedding-web/vitest.config.ts`, `wedding-web/src/test/app-smoke.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A2 — Public Web toolchain

- [ ] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [ ] No API secret or backend package exists in the browser bundle configuration.

### CP-05: Establish the Management Web Next.js baseline

**Description:** Scaffold `wedding-manage-web` independently with Next.js 16.3.6, React 19.2.3, strict TypeScript, npm, and API-contract dependencies.

**Acceptance criteria:**

- [ ] The repository is an independent App Router application for Manager/Staff surfaces.
- [ ] It does not import the Public Web repository or backend source.
- [ ] Public environment parsing permits only the API base URL and other explicitly public values.

**Verification:**

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm ls next react react-dom typescript`

**Dependencies:** None; may run in parallel with CP-01, CP-03, and CP-07.  
**Files likely touched:** framework-generated Next.js configuration set plus `wedding-manage-web/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-06: Add the Management Web shell and quality harness

**Description:** Create a minimal Auth/Manager/Staff route-group shell and prove all local quality commands without implementing RBAC or domain screens.

**Acceptance criteria:**

- [ ] Auth, Manager, and Staff route groups exist as structure only.
- [ ] Vitest/Testing Library has one rendering smoke test.
- [ ] Lint, typecheck, test, coverage, and build use the same command names as Public Web.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm run test:coverage`
- [ ] `npm run build`

**Dependencies:** CP-05  
**Files likely touched:** `wedding-manage-web/app/layout.tsx`, `wedding-manage-web/app/page.tsx`, `wedding-manage-web/eslint.config.mjs`, `wedding-manage-web/vitest.config.ts`, `wedding-manage-web/src/test/app-smoke.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A3 — Management Web toolchain

- [ ] Clean install, lint, typecheck, unit test, coverage, and build all pass.
- [ ] Manager and Staff are only route partitions; no client-side authorization is treated as authoritative.

### CP-07: Establish the Expo SDK 57 baseline

**Description:** Scaffold `wedding-app` as an Android-first Expo SDK 57 project using Expo Router, strict TypeScript, npm, and SDK-compatible package installation.

**Acceptance criteria:**

- [ ] Expo SDK 57, React Native 0.86, and React 19.2.3 are resolved compatibly.
- [ ] `src/app` is the router root and secrets are not exposed through `EXPO_PUBLIC_*`.
- [ ] The repository declares Android as the required platform without deleting framework-required iOS metadata prematurely.

**Verification:**

- [ ] `npm ci`
- [ ] `npx expo-doctor`
- [ ] `npm run typecheck`

**Dependencies:** None; may run in parallel with CP-01, CP-03, and CP-05.  
**Files likely touched:** framework-generated Expo configuration set plus `wedding-app/src/lib/env.ts`  
**Estimated scope:** Medium scaffold exception

### CP-08: Add the Expo Router shell and Android test harness

**Description:** Add route-only navigation structure for Auth/Couple, a minimal screen body outside the router tree, and SDK-compatible Jest coverage.

**Acceptance criteria:**

- [ ] `src/app` contains route files only; screen UI lives under `src/screens`.
- [ ] A smoke test renders the initial screen with `jest-expo`.
- [ ] Android JS export/build script succeeds without requiring a cloud build.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `npx expo-doctor`

**Dependencies:** CP-07  
**Files likely touched:** `wedding-app/src/app/_layout.tsx`, `wedding-app/src/app/index.tsx`, `wedding-app/src/screens/home.tsx`, `wedding-app/jest.config.js`, `wedding-app/src/screens/home.test.tsx`  
**Estimated scope:** Medium

#### Checkpoint A4 — Expo toolchain

- [ ] Clean install, lint, typecheck, test, coverage, Android export, and Expo Doctor pass.
- [ ] No product feature, iOS acceptance work, or privileged Supabase client is introduced.

## Phase B — Backend Process and HTTP Contract

### CP-09: Implement the backend environment boundary

**Description:** Parse all core backend configuration once with Zod, expose immutable typed configuration, and fail fast on invalid production values.

**Acceptance criteria:**

- [ ] Required, optional, conditional, URL, origin-list, boolean, and numeric settings follow the approved spec.
- [ ] Enabling a provider without its required configuration fails before server start.
- [ ] Tests cover valid development/test values and every required production failure branch.

**Verification:**

- [ ] `npm run test:unit -- env`
- [ ] `npm run typecheck`
- [ ] Manually start with one required variable absent and confirm a redacted startup failure.

**Dependencies:** CP-01, CP-02  
**Files likely touched:** `wedding-be/.env.example`, `wedding-be/src/config/env.ts`, `wedding-be/src/config/config.ts`, `wedding-be/src/config/env.test.ts`  
**Estimated scope:** Medium

### CP-10: Compose Express and implement graceful lifecycle

**Description:** Separate application construction from process startup, add bounded shutdown for HTTP/resources, and keep imports free of listen-side effects.

**Acceptance criteria:**

- [ ] `createApp` returns a testable Express app without opening a port.
- [ ] `server.ts` owns listen, SIGINT/SIGTERM, readiness state, and bounded cleanup.
- [ ] Startup and shutdown behavior is covered without orphaning handles.

**Verification:**

- [ ] `npm run test:unit -- lifecycle`
- [ ] `npm run build`
- [ ] Start and terminate locally; process exits cleanly within the configured deadline.

**Dependencies:** CP-09  
**Files likely touched:** `wedding-be/src/app.ts`, `wedding-be/src/server.ts`, `wedding-be/src/core/http/lifecycle.ts`, `wedding-be/src/core/http/lifecycle.test.ts`  
**Estimated scope:** Medium

#### Checkpoint B1 — Process lifecycle

- [ ] Invalid configuration never opens a listening port.
- [ ] App construction and process startup are independently testable.

### CP-11: Implement request context, standard errors, and validation

**Description:** Establish request IDs, typed application errors, one error envelope, 404 behavior, and reusable Zod validation at HTTP boundaries.

**Acceptance criteria:**

- [ ] Valid trusted request IDs are propagated; otherwise UUIDs are generated and returned.
- [ ] Validation, not-found, conflict, rate-limit, provider, and unexpected errors map consistently without stack leakage.
- [ ] Write schemas reject unknown fields unless explicitly documented.

**Verification:**

- [ ] `npm run test:unit -- http-contract`
- [ ] `npm run test:integration -- common-errors`
- [ ] Inspect test responses for `error.code`, `error.message`, and `error.requestId`.

**Dependencies:** CP-10  
**Files likely touched:** `wedding-be/src/core/http/request-context.ts`, `wedding-be/src/core/errors/app-error.ts`, `wedding-be/src/core/errors/error-handler.ts`, `wedding-be/src/core/http/validate.ts`, `wedding-be/tests/integration/common-errors.test.ts`  
**Estimated scope:** Medium

### CP-12: Deliver liveness and readiness endpoints

**Description:** Add a complete first vertical HTTP slice with dependency-free liveness and an injected, timeout-bounded readiness probe.

**Acceptance criteria:**

- [ ] `/health/live` returns success without calling dependencies.
- [ ] `/health/ready` returns success/failure from the probe and uses `503` when unavailable.
- [ ] Both responses carry request IDs and use stable schemas suitable for OpenAPI generation.

**Verification:**

- [ ] `npm run test:integration -- health`
- [ ] `npm run build`
- [ ] Force the readiness probe to fail and confirm liveness remains healthy.

**Dependencies:** CP-09, CP-10, CP-11  
**Files likely touched:** `wedding-be/src/core/http/health.router.ts`, `wedding-be/src/core/http/readiness.ts`, `wedding-be/src/core/http/health.schemas.ts`, `wedding-be/src/app.ts`, `wedding-be/tests/integration/health.test.ts`  
**Estimated scope:** Medium

#### Checkpoint B2 — HTTP foundation

- [ ] All backend static and unit/integration gates pass.
- [ ] Health, 404, validation, and unexpected-error responses match the spec exactly.

## Phase C — PostgreSQL and Reliability Primitives

### CP-13: Configure Prisma/PostgreSQL and create the initial migration

**Description:** Configure Prisma 7 with the PostgreSQL driver adapter, separate runtime/migration URLs, and create the initial infrastructure-only schema.

**Acceptance criteria:**

- [ ] Prisma uses `DATABASE_URL` at runtime and `MIGRATION_DATABASE_URL` for migration commands.
- [ ] The initial migration creates only `AuditLog`, `IdempotencyRecord`, required enums/indexes, and Prisma metadata.
- [ ] A PostgreSQL-backed integration test proves connect, transaction, and clean migration deployment.

**Verification:**

- [ ] `npm run db:generate`
- [ ] `npm run db:migrate:deploy` against an empty disposable PostgreSQL database.
- [ ] `npm run test:integration -- database`

**Dependencies:** CP-09, CP-10  
**Files likely touched:** `wedding-be/prisma/schema.prisma`, `wedding-be/prisma.config.ts`, `wedding-be/prisma/migrations/<timestamp>_core_platform/migration.sql`, `wedding-be/src/core/database/prisma.ts`, `wedding-be/tests/integration/database.test.ts`  
**Estimated scope:** Medium

### CP-14: Deliver the durable audit-log slice

**Description:** Implement typed, append-only audit recording with metadata allowlisting and request-context attribution.

**Acceptance criteria:**

- [ ] The service records actor, action, entity, request ID, timestamp, and redacted metadata.
- [ ] No update/delete operation exists in the application repository contract.
- [ ] Tests prove secret/PII fields are rejected or redacted before persistence.

**Verification:**

- [ ] `npm run test:unit -- audit`
- [ ] `npm run test:integration -- audit`
- [ ] Query the test table and confirm stored metadata matches the allowlist.

**Dependencies:** CP-11, CP-13  
**Files likely touched:** `wedding-be/src/core/audit/audit.types.ts`, `wedding-be/src/core/audit/audit.repository.ts`, `wedding-be/src/core/audit/audit.service.ts`, `wedding-be/src/core/audit/audit.service.test.ts`, `wedding-be/tests/integration/audit.test.ts`  
**Estimated scope:** Medium

#### Checkpoint C1 — Persistence and audit

- [ ] Fresh migration and rollback-by-new-forward-migration policy are documented and verified.
- [ ] Audit tests prove append-only application behavior and redaction.

### CP-15: Implement atomic idempotency persistence

**Description:** Build canonical request hashing, atomic database claims, state transitions, retention timestamps, and concurrency tests independent of Express.

**Acceptance criteria:**

- [ ] `(namespace, idempotencyKey)` uniqueness atomically selects one winner.
- [ ] Canonical hashing is deterministic and detects same-key/different-payload use.
- [ ] Real concurrent PostgreSQL tests show exactly one successful claim.

**Verification:**

- [ ] `npm run test:unit -- idempotency-hash`
- [ ] `npm run test:integration -- idempotency-repository`
- [ ] Repeat the concurrency test enough times to detect a check-then-insert race.

**Dependencies:** CP-13  
**Files likely touched:** `wedding-be/src/core/idempotency/request-hash.ts`, `wedding-be/src/core/idempotency/idempotency.repository.ts`, `wedding-be/src/core/idempotency/idempotency.service.ts`, `wedding-be/src/core/idempotency/request-hash.test.ts`, `wedding-be/tests/integration/idempotency-repository.test.ts`  
**Estimated scope:** Medium

### CP-16: Add idempotency HTTP claim and replay behavior

**Description:** Connect the persistence primitive to explicitly marked routes while preserving validation-before-claim and unknown-outcome safety.

**Acceptance criteria:**

- [ ] Missing/invalid keys, in-flight duplicates, payload mismatch, and completed replay use documented status/error semantics.
- [ ] Two concurrent HTTP requests execute the protected handler once.
- [ ] Unknown external outcomes remain reconcilable and are never silently re-executed.

**Verification:**

- [ ] `npm run test:integration -- idempotency-http`
- [ ] `npm run test:coverage -- idempotency`
- [ ] Inspect database state after forced success, deterministic failure, and simulated timeout.

**Dependencies:** CP-11, CP-15  
**Files likely touched:** `wedding-be/src/core/idempotency/idempotency.middleware.ts`, `wedding-be/src/core/idempotency/response-codec.ts`, `wedding-be/src/core/idempotency/idempotency.policy.ts`, `wedding-be/src/app.ts`, `wedding-be/tests/integration/idempotency-http.test.ts`  
**Estimated scope:** Medium

#### Checkpoint C2 — Idempotency

- [ ] Atomic winner, replay, mismatch, in-flight, and unknown-outcome scenarios pass.
- [ ] No test uses an in-memory substitute for the database concurrency proof.

## Phase D — Contract, Observability, and Security

### CP-17: Generate and verify the OpenAPI 3.1 contract

**Description:** Register Zod route schemas, generate the canonical artifact deterministically, serve it under the configured policy, and add contract checks.

**Acceptance criteria:**

- [ ] `openapi/openapi.json` is generated from the same Zod schemas used at runtime.
- [ ] Regeneration is byte-stable and `api:check` fails on drift.
- [ ] Health, common errors, pagination, request ID, and idempotency components are documented.

**Verification:**

- [ ] `npm run api:generate`
- [ ] `npm run api:check`
- [ ] `npm run test:contract`

**Dependencies:** CP-11, CP-12, CP-16  
**Files likely touched:** `wedding-be/src/core/openapi/registry.ts`, `wedding-be/src/core/openapi/generate.ts`, `wedding-be/src/core/openapi/openapi.router.ts`, `wedding-be/openapi/openapi.json`, `wedding-be/tests/contract/openapi.test.ts`  
**Estimated scope:** Medium

### CP-18: Add structured logging, correlation, and redaction

**Description:** Add Pino-based event logs that share request context, use stable fields, name entry points, and prevent secret/PII leakage.

**Acceptance criteria:**

- [ ] Production output is structured JSON; local output may use a readable transport.
- [ ] Request ID and entry point are present on every request log and provider child logger.
- [ ] Redaction tests cover authorization, cookies, tokens, contact data, payment fields, and request bodies.

**Verification:**

- [ ] `npm run test:unit -- logging`
- [ ] `npm run test:integration -- request-logging`
- [ ] Capture an induced error and locate all related events by request ID.

**Dependencies:** CP-09, CP-11  
**Files likely touched:** `wedding-be/src/core/logging/logger.ts`, `wedding-be/src/core/logging/request-logger.ts`, `wedding-be/src/core/logging/redaction.ts`, `wedding-be/src/app.ts`, `wedding-be/src/core/logging/logging.test.ts`  
**Estimated scope:** Medium

#### Checkpoint D1 — Contract and logs

- [ ] OpenAPI generation is deterministic and contract tests pass.
- [ ] Induced failures are diagnosable by request ID with no secret/PII leakage.

### CP-19: Add RED metrics and optional OpenTelemetry startup

**Description:** Instrument normalized HTTP/provider rate, errors, and duration while keeping labels bounded and tracing entirely optional.

**Acceptance criteria:**

- [ ] Histograms support p50/p95/p99 analysis and labels never include raw URLs, IDs, or messages.
- [ ] `/internal/metrics` is disabled by default and protected when enabled.
- [ ] The process runs normally with no OTLP endpoint and initializes tracing before application imports when configured.

**Verification:**

- [ ] `npm run test:unit -- observability`
- [ ] `npm run test:integration -- metrics`
- [ ] Inspect metric series after successful and failed test requests for bounded labels.

**Dependencies:** CP-10, CP-18  
**Files likely touched:** `wedding-be/src/core/observability/metrics.ts`, `wedding-be/src/core/observability/tracing.ts`, `wedding-be/src/core/observability/metrics.router.ts`, `wedding-be/src/server.ts`, `wedding-be/tests/integration/metrics.test.ts`  
**Estimated scope:** Medium

### CP-20: Apply the HTTP security baseline

**Description:** Configure security headers, explicit CORS, body limits, request deadlines, one-replica rate limits, and consistent security error responses.

**Acceptance criteria:**

- [ ] Helmet and CORS settings match environment configuration; wildcard credentialed CORS is impossible.
- [ ] JSON/body size, timeout, and general rate-limit failures use the common error envelope.
- [ ] Configuration makes the one-process rate-limit limitation explicit and blocks accidental multi-replica claims.

**Verification:**

- [ ] `npm run test:integration -- security`
- [ ] Inspect response headers and blocked-origin behavior.
- [ ] Trigger body-size, timeout, and rate-limit paths and confirm status plus `Retry-After` where applicable.

**Dependencies:** CP-09, CP-11, CP-18  
**Files likely touched:** `wedding-be/src/core/http/security.ts`, `wedding-be/src/core/http/rate-limit.ts`, `wedding-be/src/app.ts`, `wedding-be/.env.example`, `wedding-be/tests/integration/security.test.ts`  
**Estimated scope:** Medium

#### Checkpoint D2 — Operable and hardened API

- [ ] Contract, logging, metrics, tracing-disabled, and security suites pass together.
- [ ] No public response leaks stack traces, SQL details, provider payloads, or secrets.

## Phase E — External Provider Boundaries

### CP-21: Implement the Supabase Storage boundary

**Description:** Define purpose-scoped object operations, an offline fake, a Supabase adapter, signed-read URLs, and defensive response/file validation.

**Acceptance criteria:**

- [ ] Callers provide a purpose/resource identity, never an arbitrary bucket/path.
- [ ] The adapter persists object keys rather than signed URLs and defaults reads to 15-minute URLs.
- [ ] Tests cover success, invalid MIME/content metadata, timeout, missing object, and unsafe key attempts without network calls.

**Verification:**

- [ ] `npm run test:unit -- storage-provider`
- [ ] `npm run typecheck`
- [ ] Search outside `src/integrations/storage` and confirm no Supabase Storage SDK type escapes.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/storage/storage-provider.ts`, `wedding-be/src/integrations/storage/storage.schemas.ts`, `wedding-be/src/integrations/storage/fake-storage-provider.ts`, `wedding-be/src/integrations/storage/supabase-storage-provider.ts`, `wedding-be/src/integrations/storage/storage-provider.test.ts`  
**Estimated scope:** Medium

### CP-22: Implement the Resend email boundary

**Description:** Define idempotent transactional email commands, an offline fake, and a Resend adapter with timeouts and normalized failures.

**Acceptance criteria:**

- [ ] Every send command requires a deterministic intent idempotency key.
- [ ] The adapter validates provider responses and never exposes raw SDK errors to application callers.
- [ ] Tests cover success, same-intent retry, mismatched payload, provider conflict, timeout, and transient failure offline.

**Verification:**

- [ ] `npm run test:unit -- email-provider`
- [ ] `npm run typecheck`
- [ ] Search outside `src/integrations/email` and confirm no Resend SDK type escapes.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/email/email-provider.ts`, `wedding-be/src/integrations/email/email.schemas.ts`, `wedding-be/src/integrations/email/fake-email-provider.ts`, `wedding-be/src/integrations/email/resend-email-provider.ts`, `wedding-be/src/integrations/email/email-provider.test.ts`  
**Estimated scope:** Medium

### CP-23: Implement the Gemini AI image boundary

**Description:** Define safe image-generation commands, an offline fake, and a Gemini adapter with configurable model, resource caps, and untrusted-output validation.

**Acceptance criteria:**

- [ ] No caller sends guest, payment, authentication, or unrelated PII through the contract.
- [ ] Returned images are validated for schema, MIME, dimensions, and byte size before acceptance.
- [ ] Tests cover success, safety refusal, invalid output, timeout, quota/transient failure, and disabled provider offline.

**Verification:**

- [ ] `npm run test:unit -- ai-image-provider`
- [ ] `npm run typecheck`
- [ ] Search outside `src/integrations/ai-image` and confirm no Gemini SDK type escapes.

**Dependencies:** CP-09, CP-11, CP-18, CP-20  
**Files likely touched:** `wedding-be/src/integrations/ai-image/ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/ai-image.schemas.ts`, `wedding-be/src/integrations/ai-image/fake-ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/gemini-ai-image-provider.ts`, `wedding-be/src/integrations/ai-image/ai-image-provider.test.ts`  
**Estimated scope:** Medium

#### Checkpoint E — Provider isolation

- [ ] All provider tests pass with network disabled.
- [ ] SDK imports/types remain adapter-local and provider logs pass redaction checks.
- [ ] No billable call or external mutation occurred.

## Phase F — Typed API Clients

### CP-24: Connect Public Web to the generated API contract

**Description:** Generate the Public Web schema from an immutable backend artifact and create one typed fetch wrapper with normalized errors, timeout, base URL, and request ID behavior.

**Acceptance criteria:**

- [ ] Generated declarations include source digest metadata and are never hand-edited.
- [ ] `api:check` fails on intentional drift and accepts the canonical artifact.
- [ ] Wrapper tests cover successful data, structured API errors, malformed responses, and timeout.

**Verification:**

- [ ] `npm run api:generate`
- [ ] `npm run api:check`
- [ ] `npm run test:unit -- api-client`

**Dependencies:** CP-03, CP-04, CP-17  
**Files likely touched:** `wedding-web/scripts/generate-api.mjs`, `wedding-web/api-contract.lock.json`, `wedding-web/src/lib/api/generated/schema.d.ts`, `wedding-web/src/lib/api/client.ts`, `wedding-web/src/lib/api/client.test.ts`  
**Estimated scope:** Medium

### CP-25: Connect Management Web to the generated API contract

**Description:** Apply the same immutable contract and typed wrapper pattern independently in `wedding-manage-web`.

**Acceptance criteria:**

- [ ] The digest matches Public Web for the same backend contract.
- [ ] No Manager/Staff authorization decision is implemented in the wrapper.
- [ ] Success, structured errors, malformed responses, and timeout are tested.

**Verification:**

- [ ] `npm run api:generate`
- [ ] `npm run api:check`
- [ ] `npm run test:unit -- api-client`

**Dependencies:** CP-05, CP-06, CP-17  
**Files likely touched:** `wedding-manage-web/scripts/generate-api.mjs`, `wedding-manage-web/api-contract.lock.json`, `wedding-manage-web/src/lib/api/generated/schema.d.ts`, `wedding-manage-web/src/lib/api/client.ts`, `wedding-manage-web/src/lib/api/client.test.ts`  
**Estimated scope:** Medium

### CP-26: Connect Expo to the generated API contract and prepare EAS

**Description:** Generate Expo API types, implement an abortable React Native fetch wrapper, and add an Android preview EAS profile without running a cloud build.

**Acceptance criteria:**

- [ ] Contract digest matches both web clients.
- [ ] The client handles offline/network timeout separately from structured API errors and contains no auth storage policy yet.
- [ ] `eas.json` contains a valid Android preview profile and no credential material.

**Verification:**

- [ ] `npm run api:generate && npm run api:check`
- [ ] `npm run test -- api-client`
- [ ] `npx expo-doctor`

**Dependencies:** CP-07, CP-08, CP-17  
**Files likely touched:** `wedding-app/scripts/generate-api.mjs`, `wedding-app/api-contract.lock.json`, `wedding-app/src/lib/api/generated/schema.d.ts`, `wedding-app/src/lib/api/client.ts`, `wedding-app/eas.json`  
**Estimated scope:** Medium

#### Checkpoint F — Cross-repository contract

- [ ] All three generated schema files identify the same backend artifact digest.
- [ ] Every client `api:check`, test, typecheck, and build passes.
- [ ] No client imports backend source or contains provider service secrets.

## Phase G — CI, Documentation, and Acceptance

### CP-27: Add backend CI with PostgreSQL integration gates

**Description:** Create a GitHub Actions pipeline for static gates, unit/contract tests, PostgreSQL migration/integration tests, build, and dependency audit.

**Acceptance criteria:**

- [ ] Pull requests and pushes to `main` run Node 24 with `npm ci`.
- [ ] A disposable PostgreSQL service runs migration and integration suites with test-only credentials.
- [ ] Failures block the job; no test, audit, or migration gate is marked continue-on-error.

**Verification:**

- [ ] Validate workflow syntax.
- [ ] Run all workflow commands locally or in an equivalent clean environment.
- [ ] Confirm artifacts/logs contain no secrets.

**Dependencies:** CP-13 through CP-23  
**Files likely touched:** `wedding-be/.github/workflows/ci.yml`, `wedding-be/.github/dependabot.yml`, `wedding-be/package.json`  
**Estimated scope:** Medium

### CP-28: Add Public Web CI and immutable contract verification

**Description:** Gate Public Web changes on static quality, tests, production build, audit, and an OpenAPI artifact matching its lock metadata.

**Acceptance criteria:**

- [ ] PR/main events use Node 24 and `npm ci`.
- [ ] Contract verification uses an exact backend commit/release artifact, never a moving branch.
- [ ] Lint, typecheck, coverage, build, API check, and high-severity audit failures block merge.

**Verification:**

- [ ] Validate workflow syntax.
- [ ] Run the exact workflow commands locally.
- [ ] Intentionally alter the digest in a local copy and confirm contract verification fails.

**Dependencies:** CP-24  
**Files likely touched:** `wedding-web/.github/workflows/ci.yml`, `wedding-web/.github/dependabot.yml`  
**Estimated scope:** Small

#### Checkpoint G1 — Backend and Public Web CI

- [ ] Both workflows contain every required gate and use no production secrets.
- [ ] Expected runtime is under 10 minutes or an optimization note is recorded.

### CP-29: Add Management Web CI and immutable contract verification

**Description:** Apply the same independent quality and immutable-contract gates to the Manager/Staff repository.

**Acceptance criteria:**

- [ ] PR/main events use Node 24 and `npm ci`.
- [ ] Contract digest/source verification is identical in meaning to Public Web.
- [ ] All required gates block failures.

**Verification:**

- [ ] Validate workflow syntax.
- [ ] Run the exact workflow commands locally.
- [ ] Confirm an intentional contract mismatch fails.

**Dependencies:** CP-25  
**Files likely touched:** `wedding-manage-web/.github/workflows/ci.yml`, `wedding-manage-web/.github/dependabot.yml`  
**Estimated scope:** Small

### CP-30: Add Expo CI quality gates

**Description:** Gate Expo changes on SDK health, lint, types, Jest coverage, Android JS export/build, contract check, and dependency audit without consuming EAS cloud build capacity.

**Acceptance criteria:**

- [ ] PR/main events use Node 24 and `npm ci`.
- [ ] `expo-doctor`, contract verification, tests, and Android export run without EAS credentials.
- [ ] EAS cloud build remains manual/later and is not silently triggered by CI.

**Verification:**

- [ ] Validate workflow syntax.
- [ ] Run the exact workflow commands locally.
- [ ] Confirm the workflow contains no signing or service-account material.

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
