# Implementation Plan: Wedding Management System

Core-platform plan status: Approved by project owner on 2026-09-24<br>
Post-core program extension status: Approved by project owner on 2026-09-27<br>
Approved platform specification: [`../SPEC-core-platform.md`](../SPEC-core-platform.md)<br>
Approved product requirements: [`../PRODUCT-REQUIREMENTS.md`](../PRODUCT-REQUIREMENTS.md)<br>
Capability map: [`../CAPABILITY-MAP.md`](../CAPABILITY-MAP.md)<br>
Task list: [`todo.md`](./todo.md)<br>
Initially prepared: 2026-09-24<br>
Extended: 2026-09-27

## 1. Overview

Implement the approved wedding-management capabilities across four independent repositories in the dependency order recorded by `CAPABILITY-MAP.md`. The currently detailed CP-01 through CP-32 work establishes `core-platform`: reproducible TypeScript toolchains, a production-minded Express/Prisma foundation, a generated OpenAPI contract, three typed API clients, provider boundaries, security/observability primitives, and independent CI quality gates.

The post-core extension adds rolling specification and planning gates for every later module. A module receives detailed implementation tasks only after its own `SPEC-<module-id>.md` is approved. This preserves the completed and in-progress core-platform history while preventing unapproved API, state-machine, security, or data-retention assumptions from entering implementation tasks.

The plan remains front-loaded with the highest-risk foundations: PostgreSQL migration behavior, HTTP/error conventions, idempotency concurrency, deterministic API generation, prospect-to-Couple authorization, revision-bound approvals, private media, attendance concurrency, and immutable print snapshots.

## 2. Planning Assumptions

- At the initial plan approval all four repositories were empty. CP-01 through CP-06 are now complete; CP-07 onward remain governed by their existing checklist state in `todo.md`.
- `wedding-be/tasks/` is the coordination location for this cross-repository capability. Product code remains in its owning repository.
- Implementation uses a short-lived `codex/core-platform` branch in each repository unless the project owner requests direct work on the saved checkout.
- Each repository owns its own npm manifest, lockfile, CI workflow, and commit history.
- The implementation may use fake providers for all automated tests; live Supabase, Resend, Gemini, and EAS credentials are not required to complete local foundation tasks.
- Framework-generated scaffold files are reviewed as one scaffold operation, but human-authored follow-up tasks remain limited to approximately five files.
- Phase estimates are sequencing guidance, not delivery promises; verification evidence determines completion.
- `PRODUCT-REQUIREMENTS.md` and the revised capability map are approved, but no later module is authorized for implementation until its module specification and detailed task slice pass their own human review gate.
- The task list is a rolling plan: completed CP tasks are immutable history, unchecked CP tasks remain active, and later module tasks are inserted only by the corresponding specification gate.

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
10. A prospective couple uses authenticated restricted Web access before deposit; a successful deposit promotes the same identity to full Couple access.
11. Timeline and print approvals bind to immutable revisions, and deposit eligibility is rechecked authoritatively by the backend.
12. Guest groups belong to `guest-rsvp`; fixed layout geometry belongs to `venue-catalog`; table labeling belongs to `seating-plan`.
13. Event check-in records invitation-household arrivals and corrections rather than per-seat occupancy or physical-invitation QR credentials.
14. `payments-billing` precedes `invitation-studio` because accepted print charges become booking receivables.

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
| Restricted prospect access accidentally exposes full Couple features | High | Specify explicit entitlements, deny-by-default backend authorization, and direct endpoint tests before UI work |
| Timeline edit races with approval or payment initiation | High | Bind approvals to immutable revisions and add transactional concurrency tests at the booking/payment boundary |
| Private wedding media leaks through public invitation assets | High | Separate private object purposes, use short-lived signed access, and test cross-booking/public denial |
| Guest and seating ownership creates a dependency cycle | High | Keep guest-group identity in `guest-rsvp`; consume it from `seating-plan` without reverse imports |
| Concurrent arrivals lose or double-count attendance | High | Store append-only arrival/correction records and test real concurrent updates |
| Approved print content or price changes silently | High | Snapshot printable and commercial revisions atomically when the Couple approves the quotation |

## 9. Inputs Deferred Without Blocking This Plan

- Live Supabase credentials and final bucket identifiers.
- Resend verified sender domain.
- Gemini API key and selected production image model.
- EAS account/project ID and Android application identifier.
- Production hosting providers, domains, and telemetry exporter.
- Workspace invitation lifetime and reissue limits.
- Wedding-media MIME, size, dimension, quota, and cutoff policies.
- Timeline item limits and notification lead times.
- Layout capacity ranges and Manager exception-reason policy.
- Print quotation expiry, cancellation deadline, paper/finish catalog, and fulfillment service levels.
- Guest-search ranking and duplicate-name escalation procedure.

Fake adapters and placeholder `.env.example` values keep these inputs from blocking local implementation. Live integration smoke tests are scheduled only after the owner supplies credentials and authorizes external calls.

## 10. Core-Platform Approval Gate

The original approval authorizes work on `core-platform` only. CP-01 through CP-32 and their checkpoints remain unchanged in meaning; later capabilities still require their own approved specs, detailed vertical slices, and human approval.

## 11. Post-Core Dependency Graph

```text
CP-32 + core-platform implementation approval
        |
SPEC-01 identity-access spec and detailed plan
        |
identity-access implementation + evidence approval
        |
SPEC-02 venue-catalog spec and detailed plan
        |
venue-catalog implementation + evidence approval
        |
SPEC-03 booking-lifecycle spec and detailed plan
        |
booking-lifecycle implementation + evidence approval
        |
SPEC-04 payments-billing spec and detailed plan
        |
payments-billing implementation + evidence approval
        |
SPEC-05 invitation-studio spec and detailed plan
        |
SPEC-06 guest-rsvp spec and detailed plan
        |
SPEC-07 seating-plan spec and detailed plan
        |
SPEC-08 staff-operations spec and detailed plan
        |
SPEC-09 notifications-automation spec and detailed plan
        |
SPEC-10 analytics-dashboard spec and detailed plan
        |
SPEC-11 release-demo spec and detailed plan
```

A `SPEC-*` gate writes and approves the owning module spec, resolves that module's deferred configuration values, fixes provider contracts and state transitions, and then expands `todo.md` with small vertical implementation tasks. Completion of a specification gate does not itself authorize the next provider-dependent module; the current module must be implemented, verified, and approved first.

## 12. Anticipated Module Slices

These are planning boundaries, not yet-authorized implementation tasks. The owning module spec may refine or split them but must not remove approved product requirements.

| Module | Anticipated vertical slices | Product requirement ownership |
|---|---|---|
| `identity-access` | prospect invitation bootstrap; sessions and RBAC; restricted entitlements; post-deposit promotion | ACC-002 through ACC-007 |
| `venue-catalog` | restaurant/hall/menu baseline; timeline templates; versioned fixed-layout templates and capacity ranges | SEA-001, SEA-002 plus existing catalog scope |
| `booking-lifecycle` | consultation workspace; timeline revisions; dual approval; deposit eligibility; post-deposit change requests | ACC-001, TML-001 through TML-008 |
| `payments-billing` | deposit/manual/VNPay flows; balance/invoices; accepted print charges | PRN-006 plus existing payment scope |
| `invitation-studio` | invitation designs; private media library; generic public QR; printable snapshots; print quotation and fulfillment | MED-001 through MED-006; PRN-001 through PRN-005; PRN-007 through PRN-009; QRC-001 through QRC-004 |
| `guest-rsvp` | invitation households; default/custom guest groups; personalized delivery and RSVP | GST-001 through GST-008, QRC-005 |
| `seating-plan` | compatible layout selection; table-level group labels; headcount invalidation and Manager exception | SEA-003 through SEA-008 |
| `staff-operations` | household search; multi-arrival check-in; over-expected warnings; audited corrections and group guidance | CHK-001 through CHK-008 |
| `notifications-automation` | domain-event subscriptions; safe operational email/push; deadlines and completion jobs | OPS-001, OPS-002 plus existing automation scope |
| `analytics-dashboard` | revenue/receivables KPIs; grouped expected-versus-actual attendance; print fulfillment reporting | OPS-003, OPS-004 plus existing dashboard scope |
| `release-demo` | seeded cross-module journey; deployed Web/API; Android preview build; rollback and demo evidence | All approved capabilities |

## 13. Cross-Module Verification Checkpoints

### Access and commercial checkpoint

- A restricted prospect can collaborate on timeline revisions but receives backend denial from media, guest, seating, invitation, and print endpoints.
- The same identity gains full Couple access only after successful deposit.
- Payment initiation fails when the latest timeline revision lacks both active approvals.

### Planning and print checkpoint

- Private media is isolated by booking and never reachable from the generic public invitation.
- Guest-group identity remains stable across invitation households and fixed-layout table labels.
- Print approval freezes design, timeline, seating, QR, and commercial revisions before the charge enters receivables.

### Event-operations checkpoint

- Separate and concurrent arrivals accumulate correctly, over-expected attendance warns without blocking, and corrections remain auditable.
- Staff guide guests by group/color without per-person table or seat assignments.
- The generic physical-invitation QR cannot identify a guest, RSVP for a guest, or mutate check-in state.

## 14. Post-Core Planning Rules

- Each `SPEC-<module-id>.md` must cover objective, commands, project structure, code style, testing strategy, boundaries, state transitions, security/privacy, retention, and success criteria.
- Every owned requirement ID from `PRODUCT-REQUIREMENTS.md` must map to at least one acceptance criterion and one planned automated test.
- Detailed implementation tasks must be vertical slices, normally touch no more than five human-authored files, identify dependencies, and include focused plus checkpoint verification.
- Provider interfaces and OpenAPI changes are fixed before consumer UI tasks may run in parallel.
- No task may silently reintroduce per-person seating, editable layout geometry, printed recipient names, per-recipient physical QR codes, or QR check-in.

## 15. Post-Core Extension Approval Gate

The project owner approved this extension and the SPEC-01 through SPEC-11 sequence on 2026-09-27. The approval authorizes staged specification and planning only. Each module still requires explicit spec/plan approval before its implementation starts.

## 16. Identity-Access Implementation Plan

Status: **Approved by project owner on 2026-10-03**

Specification: [`../SPEC-identity-access.md`](../SPEC-identity-access.md)

Requirement ownership: ACC-002 through ACC-007

This section defines the approved implementation sequence for `identity-access`.
Checkpoint H1 approved decisions D1 through D7 and authorizes IA-01 through IA-17 in
their recorded dependency order. Changes covered by the stop conditions still require
project-owner review.

### 16.1 Decision and dependency graph

```text
D1-D7 owner approval at H1
            |
            v
IA-01 decision/config lock
      |                 \
      v                  v
IA-02 crypto/config   IA-03 schema/migration
      \                  /
       v                v
       IA-04 accounts/passwords
                |
                v
       IA-05 login/session
                |
                v
       IA-06 rotation/revocation
                |
                v
       IA-07 actor/access ---- Checkpoint I1
                    |
          +---------+---------+
          v         v         v
     IA-08 HTTP  IA-09 reset  IA-10 invitation lifecycle
                                  |
                                  v
                           IA-11 invitation acceptance
                                  |
                                  v
                           IA-12 promotion/provider ports ---- Checkpoint I2
                                  |
            IA-08 + IA-09 -------+
                                  v
                           IA-13 publish contract
                         /          |          \
                        v           v           v
                 IA-14 Public   IA-15 Manage   IA-16 Android
                        \           |           /
                         v          v          v
                      IA-17 cross-repository acceptance ---- Checkpoint I3
```

Backend security and persistence precede every client. After IA-13 fixes the generated
contract, the three client tasks may proceed in parallel. No client task may implement
an authorization rule; clients only transport credentials and present the current
backend result.

### 16.2 Ordered slices

| Task | Deliverable | Repository | Depends on | Focused proof |
| --- | --- | --- | --- | --- |
| IA-01 | Record approved D1-D7 values, environment names, cookie/deep-link policy, and operator bootstrap boundary. | `wedding-be` docs/config examples | H1 | Decision table has no unresolved implementation input; secret scan and formatting pass. |
| IA-02 | Add versioned password/token crypto and auth configuration parsing without an HTTP surface. | `wedding-be` | IA-01 | Unit tests cover scrypt verification, constant-time token comparison, entropy, expiry edges, redaction, and a recorded deployment-runtime cost benchmark. |
| IA-03 | Add forward-only identity schema/migration and database constraint tests. | `wedding-be` | IA-01 | Empty deploy succeeds; normalized-email and single-winner constraints fail safely under PostgreSQL. |
| IA-04 | Add account/password repository and service behavior, including bootstrap-only Manager creation and retention eligibility. | `wedding-be` | IA-02, IA-03 | Known/unknown verification is externally indistinguishable; disabled accounts and retention holds fail closed. |
| IA-05 | Add access/refresh issuance and email/password session creation. | `wedding-be` | IA-04 | Only token hashes persist; account/session state is checked; throttling and audit assertions pass. |
| IA-06 | Add atomic refresh rotation, replay-family revocation, logout, inventory, and owned-session revocation. | `wedding-be` | IA-05 | Concurrent refresh has one winner and replay revokes the family. |
| IA-07 | Add authenticated actor middleware plus role and consultation-access readers. | `wedding-be` | IA-06 | Forged roles, stale credentials, disabled accounts, cross-consultation access, and ACC-004 capabilities are denied. |
| IA-08 | Publish session, current-user, and logout routes through strict Zod/OpenAPI schemas. | `wedding-be` | IA-07 | Contract tests cover Web/Android transport, bounded session pagination, explicit retry semantics, allowed Origin, no-store, stable errors, and no secret echo. |
| IA-09 | Add enumeration-safe password-reset request/completion and notification intent. | `wedding-be` | IA-04, IA-06 | Reset is single-use, expires, revokes all sessions, and emits no email/token in logs or audit data. |
| IA-10 | Add explicit invitation issue/reissue/revoke lifecycle and notification intent. | `wedding-be` | IA-03, IA-04 | Exactly one active invitation survives; expiry, reissue limit, idempotency, and audit tests pass. |
| IA-11 | Add atomic invitation acceptance and restricted Web-session creation. | `wedding-be` | IA-05, IA-10 | Accept/reissue races have one valid outcome; existing/new account paths obey D7; consumed tokens cannot replay. |
| IA-12 | Add consultation-access provider and idempotent Couple promotion port. | `wedding-be` | IA-07, IA-11 | Concurrent promotion is monotonic, preserves identity, atomically upserts the `COUPLE` role, rejects mismatched payment reuse, and traces ACC-003–007. |
| IA-13 | Complete reset/invitation routes, generate OpenAPI, and publish the immutable contract artifact. | `wedding-be` | IA-08, IA-09, IA-11, IA-12 | Reset/invitation tokens are POST-body-only; contract, deterministic generation, digest, backend quality, migration, and integration gates pass. |
| IA-14 | Implement Public Web login, invitation acceptance, reset, memory-only access state, cookie refresh, and restricted/full presentation. | `wedding-web` | IA-13 | Browser tests prove fragment removal, no Web Storage token, session restore/logout, and backend-denial handling. |
| IA-15 | Implement Management Web login/reset, memory-only access state, cookie refresh, and Manager/Staff presentation guards. | `wedding-manage-web` | IA-13 | Browser tests prove forged UI state grants nothing and session restore/logout behave correctly. |
| IA-16 | Implement Android login/reset, SecureStore refresh persistence, process restore, rotation, and logout cleanup. | `wedding-app` | IA-13 | Tests prove no AsyncStorage token, secure restore, rotated token replacement, and logout deletion. |
| IA-17 | Run and record the cross-repository identity-access acceptance audit. | all four | IA-14, IA-15, IA-16 | ACC-002–007 trace, clean installs, repository gates, secret/PII scan, concurrency suite, and owner review evidence are complete. |

Each implementation task is further constrained in `todo.md` to a small file group,
normally no more than five human-authored files. A task that exceeds that boundary must
be split before implementation instead of silently growing.

### 16.3 Verification checkpoints

**Checkpoint I1 — Authentication core:** IA-02 through IA-07 must pass unit,
PostgreSQL integration, concurrency, audit, redaction, lint, typecheck, and coverage
checks. No HTTP or client work proceeds with a failing credential/session primitive.

**Checkpoint I2 — Identity contracts:** IA-08 through IA-12 must prove every state
transition, denial, replay, and provider contract before the OpenAPI artifact is fixed.
The review specifically checks that `booking-lifecycle` and `payments-billing` depend on
identity-owned ports without a reverse import.

**Checkpoint I3 — Identity implementation approval:** IA-17 records all backend and
client evidence. The project owner must approve the completed module before SPEC-02 or
any `venue-catalog` implementation begins.

### 16.4 Risks and controls

| Risk | Control fixed by the draft |
| --- | --- |
| Stolen/replayed refresh credential | Opaque hashes, atomic rotation, absolute expiry, immediate family revocation on reuse. |
| Invitation used as permanent login | Single-use bootstrap, password verification/set, real revocable session, raw token removed from the URL fragment. |
| Duplicate identity during deposit promotion | Unique normalized account/access records and an idempotent monotonic provider port. |
| Full access without Couple role | Promotion atomically upserts `COUPLE`; restricted invitation acceptance never does. |
| Client-side role or access forgery | Actor and scoped access are rebuilt from current PostgreSQL state on every protected request. |
| Enumeration and credential stuffing | Generic outcomes, bounded per-IP/email throttling, no permanent attacker-triggered lockout. |
| PII or credential leakage | Allowlisted audit/metrics, core redaction tests, no browser durable storage, hash-only persistence. |
| Cross-repository contract drift | Backend-first OpenAPI generation plus immutable digest checks in all three clients. |
| Overlarge identity change | Small ordered slices and mandatory I1/I2/I3 review points. |

### 16.5 Parallelization and stop conditions

- IA-02 and IA-03 may run in parallel after IA-01 because neither consumes the other's
  implementation.
- IA-09 may begin after account and session revocation contracts are fixed; it does not
  need invitation code.
- IA-14, IA-15, and IA-16 may run in parallel only after IA-13 publishes the exact
  immutable OpenAPI artifact.
- Stop and return to H1 if a task needs a different auth provider, token transport,
  password policy, role model, cookie/CORS policy, retention period, external store, or
  new PII field.
- Stop and split a task if its reviewed human-authored file group exceeds the stated
  small-slice boundary or combines schema, HTTP, and multi-client behavior in one step.
