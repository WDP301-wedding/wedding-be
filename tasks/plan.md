# Implementation Plan: `core-platform`

Status: Approved by project owner on 2026-09-24  
Approved specification: [`../SPEC-core-platform.md`](../SPEC-core-platform.md)  
Task list: [`todo.md`](./todo.md)  
Prepared: 2026-09-24

## 1. Overview

Implement the approved `core-platform` capability across four independent repositories without beginning any wedding-domain module. The work establishes reproducible TypeScript toolchains, a production-minded Express/Prisma foundation, a generated OpenAPI contract, three typed API clients, provider boundaries, security/observability primitives, and independent CI quality gates.

The plan is intentionally front-loaded with the highest-risk foundations: PostgreSQL migration behavior, HTTP/error conventions, idempotency concurrency, and deterministic API generation. Client shells and later provider adapters can proceed in parallel only after their required contracts are stable.

## 2. Planning Assumptions

- All four repositories are currently empty apart from `.git`; there is no legacy code or convention to preserve.
- `wedding-be/tasks/` is the coordination location for this cross-repository capability. Product code remains in its owning repository.
- Implementation uses a short-lived `codex/core-platform` branch in each repository unless the project owner requests direct work on the saved checkout.
- Each repository owns its own npm manifest, lockfile, CI workflow, and commit history.
- The implementation may use fake providers for all automated tests; live Supabase, Resend, Gemini, and EAS credentials are not required to complete local foundation tasks.
- Framework-generated scaffold files are reviewed as one scaffold operation, but human-authored follow-up tasks remain limited to approximately five files.
- Phase estimates are sequencing guidance, not delivery promises; verification evidence determines completion.

## 3. Architecture Decisions Carried into Implementation

1. `wedding-be` is the only database and business-rule authority.
2. All repositories use Node.js 24 LTS, npm, strict TypeScript, ESLint flat config, Prettier, and committed lockfiles.
3. Zod request/response schemas in the backend generate OpenAPI 3.1; client repositories consume the artifact through generated types and one `openapi-fetch` wrapper.
4. Prisma migrations are the only shared-environment schema-change mechanism. Integration tests use real PostgreSQL semantics.
5. Audit records and idempotency records are infrastructure primitives; no wedding-domain tables are introduced.
6. Supabase Storage, Resend, and Gemini SDKs remain behind local provider interfaces with fake adapters.
7. Logs are operational telemetry; PostgreSQL audit records are durable evidence. The two are never substituted for one another.
8. CI is independent per repository. A client CI job verifies an OpenAPI artifact from an immutable backend commit/release, not a moving branch.
9. Android is the only mobile acceptance target. `core-platform` validates configuration and Expo health; `release-demo` owns the final EAS artifact.

## 4. Dependency Graph

```text
Approved spec and capability map
           │
           ├───────────────┬────────────────┬─────────────────┐
           ▼               ▼                ▼                 ▼
   Backend toolchain   Public Web       Manage Web        Expo App
           │            foundation       foundation        foundation
           ▼               │                │                 │
   Backend lifecycle       │                │                 │
           │               │                │                 │
     HTTP contracts        │                │                 │
       ┌───┴─────┐         │                │                 │
       ▼         ▼         │                │                 │
  Prisma core  OpenAPI ────┼────────────────┼─────────────────┘
       │         │         ▼                ▼                 ▼
       │         │   Public client     Manage client      App client
       │         │
       ├─────────┼──────► Audit / idempotency
       │         │
       └─────────┴──────► Security / observability
                         │
                         ├────────► Storage adapter
                         ├────────► Email adapter
                         └────────► AI image adapter

All verified slices ──────────────► Per-repository CI ──► Acceptance audit
```

## 5. Delivery Strategy

### Phase A — Reproducible repository foundations

Goal: every repository can install, lint, typecheck, test, and build before cross-repository integration begins.

Tasks:

- CP-01 Backend package and compiler baseline.
- CP-02 Backend lint, formatting, and test harness.
- CP-03 Public Web package and Next.js configuration.
- CP-04 Public Web application shell and smoke test.
- CP-05 Management Web package and Next.js configuration.
- CP-06 Management Web application shell and smoke test.
- CP-07 Expo package and SDK-compatible configuration.
- CP-08 Expo Router shell and Android smoke test.

Parallelization:

- CP-01/02, CP-03/04, CP-05/06, and CP-07/08 are four independent repository streams.
- Within each stream, configuration precedes the application shell.

Checkpoint A:

- Clean `npm ci` succeeds in every repository.
- Lint, typecheck, unit-test, and build scripts exist and pass.
- Expo additionally passes `npx expo-doctor`.

### Phase B — Backend process and HTTP contract

Goal: provide a testable Express process with validated configuration and stable HTTP semantics before persistence or integrations are attached.

Tasks:

- CP-09 Backend environment/configuration boundary.
- CP-10 Express composition and graceful process lifecycle.
- CP-11 Request context, standard errors, and Zod validation.
- CP-12 Health and readiness vertical slice.

Order:

- CP-09 precedes CP-10.
- CP-11 depends on the Express composition seam created by CP-10.
- CP-12 depends on CP-09 through CP-11 but initially uses an injected readiness probe.

Checkpoint B:

- The app is importable without listening on a port.
- Invalid configuration fails before listen.
- Liveness, readiness, request IDs, 404s, validation errors, and unexpected errors satisfy the approved contract.

### Phase C — PostgreSQL infrastructure and high-risk reliability primitives

Goal: fail fast on the areas most likely to cause expensive rework: Supabase-compatible connectivity, repeatable migrations, audit persistence, and concurrent idempotency.

Tasks:

- CP-13 Prisma/PostgreSQL foundation and initial migration.
- CP-14 Durable audit-log slice.
- CP-15 Idempotency persistence and atomic-claim behavior.
- CP-16 Idempotency HTTP middleware and replay behavior.

Order:

- CP-13 is the prerequisite for CP-14 and CP-15.
- CP-16 depends on both CP-11 HTTP contracts and CP-15 persistence.
- CP-14 and CP-15 may run in parallel after the migration contract is stable.

Checkpoint C:

- Migrations apply to an empty PostgreSQL database.
- Audit writes are append-only through the application interface and redacted.
- Concurrent identical idempotency attempts execute one winner.
- Mismatched payload and in-flight duplicate behavior match the spec.

### Phase D — Contract generation, security, and observability

Goal: turn the backend foundation into a consumable, diagnosable, and hardened platform.

Tasks:

- CP-17 Deterministic OpenAPI 3.1 generation and contract tests.
- CP-18 Structured logging and request correlation.
- CP-19 RED metrics and optional OpenTelemetry bootstrap.
- CP-20 HTTP security, CORS, size limits, timeout, and rate-limit baseline.

Order and coordination:

- CP-17 depends on CP-11/12 so it can document real common responses.
- CP-18 precedes CP-19 because metrics/traces use the same normalized route and request context.
- CP-20 depends on CP-11 and must preserve the standard error envelope.
- CP-17 and CP-18 may proceed in parallel after Checkpoint B.

Checkpoint D:

- OpenAPI regeneration is byte-for-byte deterministic.
- Induced failures are discoverable by request ID without exposing secrets or PII.
- RED metrics use bounded labels.
- Security controls return the common error shape and pass focused tests.

### Phase E — External provider boundaries

Goal: prove the vendor boundaries while keeping the foundation fully testable offline.

Tasks:

- CP-21 Supabase Storage contract, fake, and adapter.
- CP-22 Resend email contract, fake, and adapter.
- CP-23 Gemini image contract, fake, and adapter.

Parallelization:

- All three tasks may proceed in parallel after CP-09, CP-18, and CP-20.
- No task performs a billable/live request in automated tests.

Checkpoint E:

- SDK types do not escape `src/integrations`.
- Every adapter validates provider output, applies timeouts, and maps failures to stable internal errors.
- Fake adapters cover success, invalid response, timeout, and refusal/transient-failure paths.

### Phase F — Typed clients in three repositories

Goal: demonstrate that all clients consume one immutable backend contract without importing backend source.

Tasks:

- CP-24 Public Web generated schema and API wrapper.
- CP-25 Management Web generated schema and API wrapper.
- CP-26 Expo generated schema and API wrapper.

Order and parallelization:

- All three depend on CP-17.
- They may run in parallel after the first stable committed OpenAPI artifact.
- The wrappers must normalize timeout, request ID, base URL, and API error handling consistently while remaining repo-local.

Checkpoint F:

- All three `api:generate` commands produce committed generated files with the same source digest.
- All three `api:check` commands fail on intentional drift and pass when regenerated.
- No client package imports `wedding-be/src`.

### Phase G — Automated quality gates and handoff documentation

Goal: make the platform reproducible on every pull request and understandable to the next module implementation.

Tasks:

- CP-27 Backend GitHub Actions quality and PostgreSQL integration pipeline.
- CP-28 Public Web GitHub Actions quality pipeline.
- CP-29 Management Web GitHub Actions quality pipeline.
- CP-30 Expo GitHub Actions quality pipeline.
- CP-31 Four-repository developer and environment documentation.
- CP-32 Final cross-repository acceptance audit.

Parallelization:

- CP-27 through CP-30 may proceed in parallel once their repository commands are stable.
- CP-31 can start after the relevant commands/configuration stop changing.
- CP-32 is strictly last.

Checkpoint G:

- Every pull request and push to `main` runs install, lint, typecheck, tests, build, and dependency audit.
- Backend CI additionally runs migrations and integration tests against PostgreSQL.
- The final audit maps evidence to all 12 success criteria in the approved spec.

## 6. Verification Model

Every implementation task must satisfy its focused checks before the next dependent task begins. Checkpoints then run the broader repository suites.

Required repository gates:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm audit --audit-level=high
```

Additional backend gates:

```bash
npm run test:integration
npm run test:contract
npm run db:migrate:deploy
npm run api:check
```

Additional client gates:

```bash
npm run api:check
```

Additional Expo gate:

```bash
npx expo-doctor
```

The EAS preview cloud build remains a later `release-demo` acceptance action; this plan only establishes and validates its configuration.

## 7. Commit and Review Strategy

- Keep one short-lived branch per repository using `codex/core-platform`.
- Commit each verified task or tightly coupled pair as an atomic save point.
- Use `chore:` for toolchain/config, `feat:` for runtime platform primitives, `test:` for standalone test additions, and `docs:` for documentation.
- Do not combine generated scaffold formatting with behavioral code in one review commit when they can be separated.
- Commit generated artifacts required by the spec: npm lockfiles, Prisma migrations, `openapi/openapi.json`, and client schema declarations.
- Never commit `.env*` secrets, build outputs, test reports, Expo credentials, or service-account files.
- Cross-repository contract changes land backend-first, followed by coordinated client commits referencing the OpenAPI digest.

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Four repositories drift in Node, TypeScript, lint, or scripts | High | Pin the baseline, use equivalent script names, and enforce each repo through CI |
| OpenAPI artifact and runtime validation diverge | High | Generate from the same Zod schemas and fail `api:check` on any diff |
| Client CI cannot access a sibling backend repository | High | Supply an artifact from an immutable backend commit/release and verify its digest |
| Supabase connection mode is wrong for Prisma Migrate | High | Test direct/session URLs explicitly; prohibit transaction mode for migrations |
| Idempotency check/act race duplicates money or messages | High | Use a unique database constraint, atomic insert, and real concurrent PostgreSQL tests |
| Provider SDK details leak into domain code | Medium | Keep SDK imports inside adapters and test against local provider interfaces/fakes |
| Logs expose PII or tokens | High | Field allowlists, serializer redaction, and tests that inspect emitted logs |
| In-memory rate limiting silently weakens after scaling | High | Declare one-replica constraint; block horizontal scale until a shared store is designed |
| Expo dependency versions become incompatible | Medium | Install Expo-managed packages with `npx expo install` and gate on `expo-doctor` |
| CI becomes slow and is bypassed | Medium | Run static gates first, parallelize independent jobs, cache npm, target under 10 minutes |
| Exact Gemini model changes before invitation work | Low | Keep the model identifier in environment configuration behind `AiImageProvider` |
| Empty repos encourage oversized first commits | Medium | Follow the task slices and checkpoint after every 2–4 tasks |

## 9. Inputs Deferred Without Blocking This Plan

- Live Supabase credentials and final bucket identifiers.
- Resend verified sender domain.
- Gemini API key and selected production image model.
- EAS account/project ID and Android application identifier.
- Production hosting providers, domains, and telemetry exporter.

Fake adapters and placeholder `.env.example` values keep these inputs from blocking local implementation. Live integration smoke tests are scheduled only after the owner supplies credentials and authorizes external calls.

## 10. Plan Approval Gate

Implementation must not begin until the project owner confirms this plan and its ordered task list. Approval authorizes work on `core-platform` only; later capabilities still require their own approved specs and plans.
