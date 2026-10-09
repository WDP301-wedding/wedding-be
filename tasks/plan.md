# Implementation Plan: Wedding Management System

Core-platform plan status: Approved by project owner on 2026-09-24<br>
Post-core program extension status: Approved by project owner on 2026-09-27<br>
Cross-module contract baseline: Locked as
[`WEDDING-CONTRACT-1@1.1.0`](../CONTRACT-BASELINE.md) on 2026-10-06 (1.0.0 history retained)<br>
SPEC-03 through SPEC-11 and three-person ownership: Approved on 2026-10-06;<br>
bounded module task/wave plans and implementation acceptance remain pending.<br>
Approved platform specification: [`../SPEC-core-platform.md`](../SPEC-core-platform.md)<br>
Approved product requirements: [`../PRODUCT-REQUIREMENTS.md`](../PRODUCT-REQUIREMENTS.md)<br>
Capability map: [`../CAPABILITY-MAP.md`](../CAPABILITY-MAP.md)<br>
Task list: [`todo.md`](./todo.md)<br>
Initially prepared: 2026-09-24<br>
Extended: 2026-09-27

## 1. Overview

Implement the approved wedding-management capabilities across four independent repositories in the dependency order recorded by `CAPABILITY-MAP.md`. The currently detailed CP-01 through CP-32 work establishes `core-platform`: reproducible TypeScript toolchains, a production-minded Express/Prisma foundation, a generated OpenAPI contract, three typed API clients, provider boundaries, security/observability primitives, and independent CI quality gates.

The post-core extension adds rolling specification and planning gates for every later
module. `WEDDING-CONTRACT-1@1.1.0` permits controlled overlap after contract approval.
SPEC-03 through SPEC-11 are now approved, but a module receives executable implementation
tasks only after its bounded plan is prepared and approved. This preserves completed and
in-progress history while preventing unapproved API, state-machine, security, or
data-retention assumptions from entering implementation tasks.

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
- `SPEC-02` remains governed by its approved venue-catalog plan through V4. The
  baseline does not reopen it, and no `booking-lifecycle` implementation starts before
  V4 acceptance.
- Every SPEC from `SPEC-03` onward declares
  `contractBaseline: WEDDING-CONTRACT-1@1.1.0`, retains inherited 1.0.0 history and lists its produced and consumed
  provider contracts and events.

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
15. Cross-module ownership, identifiers, events, snapshot semantics, compatibility,
    and change control are fixed by active `WEDDING-CONTRACT-1@1.1.0`; conflicting module
    choices require a baseline change proposal first.

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

## 11. Post-Core Contract and Dependency Graph

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
SPEC-03 booking-lifecycle final approval
        |
SPEC-04 payments-billing final approval
        |
SPEC-05 invitation-studio final approval
        |
SPEC-06 guest-rsvp final approval
        |\
        | +--> SPEC-09 notifications-automation final approval --------+
        v                                                              |
SPEC-07 seating-plan final approval                                     |
        |                                                              |
        v                                                              |
SPEC-08 staff-operations final approval                                 |
        |                                                              |
        v                                                              |
SPEC-10 analytics-dashboard final approval -----------------------------+
                                                                       |
                                                                       v
                                                        SPEC-11 release-demo
```

A `SPEC-*` draft may begin against the locked baseline before its upstream
implementation is complete. Final contract approval remains provider-first according
to the graph. After a module SPEC is approved, its plan and small vertical task slices
may be prepared; implementation uses the readiness waves in the baseline and final
integration requires real providers. A completed draft never authorizes implementation
by itself.

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

The project owner approved this extension and the SPEC-01 through SPEC-11 sequence on
2026-09-27, then approved and locked `WEDDING-CONTRACT-1@1.0.0` on 2026-10-06. The
later approval authorizes controlled overlap in drafting, final contract review, and
planning for separately approved SPECs. Each module still requires explicit SPEC and
plan approval before implementation, and each real integration waits for its provider
readiness gate.

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

## 17. Venue-Catalog Implementation Plan

Status: **Approved by project owner on 2026-10-05**

Specification: [`../SPEC-venue-catalog.md`](../SPEC-venue-catalog.md)

Requirement ownership: SEA-001 and SEA-002

The project owner approved VC-D1 through VC-D9 and then approved this exact VC-01
through VC-23 plan, its bounded Section 17.1 constants, dependency order, and V1–V4
checkpoints on 2026-10-05. Checkpoint V0 therefore authorizes implementation in the
recorded order; approval does not mean any implementation task has already started.

### 17.1 Implementation constants and dependency graph

Checkpoint V0 also approves these bounded constants for VC-01. Changing one later is a
catalog contract/policy change, not an environment override:

| Concern | Planned constant |
| --- | --- |
| Names and titles | 1–120 trimmed characters |
| Descriptions | 0–2,000 characters |
| Media alternative text | 1–250 characters |
| Table display label | 1–50 characters |
| Dish display price | Optional integer VND from 0 through 1,000,000,000 |
| Menu-package per-table price | Integer VND from 1 through 1,000,000,000 |
| Hall maximum guests | Integer from 1 through 10,000 |
| Layout table count | 1–500 tables per published version |
| Table seat capacity | Integer from 1 through 100 |
| Timeline item count | 1–100 items per published version |
| Timeline offset/duration | Offset 0–1,440 minutes; optional duration 1–1,440 minutes |
| Canvas | Fixed normalized `10000 × 10000`; integer positions 0–10,000 and positive in-bounds dimensions |
| Catalog media | At most 20 attached assets per resource; JPEG/PNG/WebP, each at most the existing 25 MiB object limit |
| Cursor page size | Default 20, maximum 100 |
| Shift windows | Minute precision, same restaurant-local day, `startTime < endTime` |

```text
VC-D1 through VC-D9 approved
              |
              v
       VC-01 policy/config lock
          /                 \
         v                   v
 VC-02 domain rules    VC-03 schema/migration
          \                 /
           v               v
        VC-04 version repository/concurrency ---- Checkpoint V1
          |       |        |        |
          v       v        v        v
       VC-05   VC-06    VC-07    VC-08
       venue   menu    timeline  layout
          \       |        |        /
           +------+---VC-09 media-+
                         |
                         v
              VC-10 provider/auth/history ---- Checkpoint V2
                  /       |       |       \
                 v        v       v        v
              VC-11    VC-12   VC-13    VC-14
              venue     menu   timeline  layout HTTP
                  \       |       |       /
                   +------+-VC-15 media/lifecycle HTTP
                                  |
                           VC-16 deterministic seed
                                  |
                           VC-17 contract freeze ---- Checkpoint V3
                          /       |        |       \
                         v        v        v        v
                      VC-18    VC-19    VC-20    VC-21
                      venue     menu    timeline  layout UI
                         \        |        |        /
                          +-------+-VC-22 media/history UI
                                      |
                                  VC-23 acceptance audit ---- Checkpoint V4
```

VC-02 and VC-03 may proceed independently after VC-01. The four service slices may be
implemented independently after the shared repository contract is stable, but their
schema/repository files must not overlap without coordination. HTTP work begins only
after V2. Management Web begins only after VC-17 fixes and publishes the generated
contract.

### 17.2 Ordered slices

| Task | Deliverable | Repository | Depends on | Focused proof |
| --- | --- | --- | --- | --- |
| VC-01 | Record approved constants, validation bounds, storage purpose, retry semantics, and operator boundaries. | `wedding-be` | V0 | No implementation input from VC-D1–D9 remains ambiguous; config/format/secret checks pass. |
| VC-02 | Add pure catalog lifecycle, version, shift, VND, timeline, capacity, and geometry policies. | `wedding-be` | VC-01 | Mutation-sensitive unit tests cover all valid/invalid boundaries without Prisma or HTTP. |
| VC-03 | Add forward-only catalog schema and migration with aggregate/version/table constraints. | `wedding-be` | VC-01 | Empty and identity-baseline deploys pass; PostgreSQL rejects duplicate/current/draft/table conflicts. |
| VC-04 | Add transactional repositories for draft CAS, publish, supersede, retire/restore, and exact-version resolution. | `wedding-be` | VC-02, VC-03 | Real PostgreSQL races have one winner and preserve immutable history. |
| VC-05 | Implement restaurant profile, fixed shifts, halls, hall snapshots, and capacity-lowering guards. | `wedding-be` | VC-04 | Service/integration tests cover active/retired reads, name collisions, snapshots, and layout-dependent capacity conflicts. |
| VC-06 | Implement dish versions and menu-package versions with ordered exact dish references and per-table price. | `wedding-be` | VC-04 | Repricing/retirement cannot mutate a published package or its historical resolution. |
| VC-07 | Implement timeline-template drafts, publication, cloning, ordering, and immutable version resolution. | `wedding-be` | VC-04 | Item bounds/order, concurrent publish, clone, supersede, and retired-history tests pass. |
| VC-08 | Implement hall-bound layout versions, stable table registry, fixed geometry, and capacity validation. | `wedding-be` | VC-04, VC-05 | SEA-001/002 unit and PostgreSQL tests prove range validation, immutable geometry, stable IDs, and non-reuse. |
| VC-09 | Extend private Storage for catalog media and add transactional attach/reorder/replacement cleanup. | `wedding-be` | VC-05, VC-06, VC-07, VC-08 | MIME/magic-byte/size/key tests and failure cleanup preserve prior assets and expose no object key. |
| VC-10 | Publish `VenueCatalogReader`, Manager authorization, current-selection reads, and exact historical resolution. | `wedding-be` | VC-05 through VC-09 | Provider tests deny retired content for new selection, resolve stored versions, and prove dependency direction. |
| VC-11 | Add public/current plus Manager restaurant, shift, and hall HTTP contracts. | `wedding-be` | V2 | Strict schema, pagination, ETag/CAS, idempotency, role denial, and public-field contract tests pass. |
| VC-12 | Add public/current plus Manager dish and menu-package HTTP contracts. | `wedding-be` | V2 | Version/price/dish-reference routes hide drafts/history and reject stale or non-Manager writes. |
| VC-13 | Add Manager timeline-template HTTP contracts without a direct Couple/prospect template route. | `wedding-be` | V2 | Draft/publish/history tests and OpenAPI inspection prove bounded immutable timeline versions. |
| VC-14 | Add Manager layout-template HTTP contracts without a Couple/public geometry mutation. | `wedding-be` | V2 | SEA-001/002 route tests cover hall/range/table invariants, stable errors, auth denials, and history. |
| VC-15 | Add catalog media upload/order and explicit lifecycle HTTP contracts. | `wedding-be` | VC-11 through VC-14 | Upload and retire/restore routes honor idempotency/CAS; signed outputs omit storage internals. |
| VC-16 | Add an explicit idempotent development/demo catalog seed. | `wedding-be` | VC-05 through VC-10 | Reruns do not duplicate/overwrite; published and retired fixtures satisfy the spec and seed never auto-runs in production. |
| VC-17 | Register all schemas, generate OpenAPI, and publish the immutable backend contract/digest. | `wedding-be` | VC-11 through VC-16 | Contract generation/check, migration, complete backend gates, and secret/object-key inspection pass. |
| VC-18 | Add Management Web catalog shell plus restaurant, shift, and hall administration. | `wedding-manage-web` | VC-17 | Component/browser tests cover responsive lists/forms, Manager guards, CAS conflicts, denials, and lifecycle feedback. |
| VC-19 | Add accessible dish and menu-package version/pricing administration. | `wedding-manage-web` | VC-17 | Tests cover integer VND input/display, ordered dishes, publish/history, retirement, stale data, and API errors. |
| VC-20 | Add timeline-template version editor and history. | `wedding-manage-web` | VC-17 | Keyboard-accessible add/edit/remove/reorder, publish, clone, and immutable-history tests pass. |
| VC-21 | Add fixed-layout editor and read-only published preview. | `wedding-manage-web` | VC-17 | Tests cover bounded geometry, stable table IDs, range/seat feedback, keyboard alternatives, responsive preview, and no Couple contract. |
| VC-22 | Add shared catalog media, history, retirement, and restoration presentation to Manager features. | `wedding-manage-web` | VC-18 through VC-21 | Upload/order/error/a11y tests pass; UI exposes no object key and cannot override backend conflicts. |
| VC-23 | Run and record the cross-repository venue-catalog acceptance audit. | backend + Management Web | VC-17, VC-22 | SEA-001/002 trace, clean migrations/seeds, concurrency, immutable contract, quality gates, secret/data review, and owner-ready evidence complete. |

Each task is constrained in `todo.md` to no more than five human-authored files. If a
slice crosses that boundary, it must be split before implementation rather than
silently expanding its file group.

### 17.3 Verification checkpoints

**Checkpoint V0 — Venue-catalog plan approval:** Approved on 2026-10-05 for VC-01
through VC-23, their Section 17.1 constants, dependency order, and V1–V4 checkpoints.
Implementation may now begin with VC-01; later checkpoints and stop conditions remain
mandatory.

**Checkpoint V1 — Catalog persistence and version core:** VC-01 through VC-04 must pass
pure-domain tests, empty/upgrade PostgreSQL migrations, constraint tests, and concurrent
publish/CAS/retirement tests. No service or HTTP slice proceeds with an ambiguous or
mutable published-version primitive.

**Checkpoint V2 — Catalog services and provider boundary:** VC-05 through VC-10 must
prove current-selection versus historical-resolution behavior, Manager-only mutation,
private media handling, and SEA-001/002 invariants. HTTP schemas may not weaken these
service contracts.

**Checkpoint V3 — Immutable catalog contract:** VC-11 through VC-17 must pass contract,
authorization, idempotency, migration, seed, coverage, lint, typecheck, build, audit,
and OpenAPI drift gates. Management Web starts only from the committed digest.

**Checkpoint V4 — Venue-catalog implementation approval:** VC-23 records all backend
and Management Web evidence. The project owner must approve the completed module before
SPEC-03 or any `booking-lifecycle` implementation begins.

### 17.4 Risks and controls

| Risk | Control fixed by the plan |
| --- | --- |
| Published price or template changes retroactively | Immutable exact versions, consumer snapshots, and historical-resolution tests. |
| Two Manager tabs publish conflicting versions | Draft CAS, transactional next-version assignment, idempotency, and PostgreSQL race tests. |
| Hall/layout capacity mismatch | Server recomputation, database ownership constraints, and capacity-lowering conflict tests. |
| Table labels point to a different physical table | Template-owned UUID registry, no ID recycling, exact layout version references. |
| Couple or forged UI mutates geometry | No Couple mutation operation in OpenAPI and direct backend role-denial tests. |
| Retiring catalog content breaks bookings or reports | New-selection exclusion separated from exact historical resolution; no hard deletion. |
| Catalog upload weakens private storage | Purpose-scoped generated keys, existing validation baseline, signed reads, failure cleanup. |
| Client drifts from backend rules | Backend-first immutable OpenAPI digest and generated Management Web types. |
| Layout editor is inaccessible or mobile-unusable | Keyboard controls, numeric field alternative, semantic forms, and responsive preview tests. |
| Oversized catalog change becomes unreviewable | Small vertical slices, five-file boundary, and V1/V2/V3/V4 review points. |

### 17.5 Parallelization and stop conditions

- VC-02 and VC-03 may run in parallel after VC-01.
- VC-05, VC-06, and VC-07 may run in parallel after VC-04 when they do not edit the
  same shared repository/schema file. VC-08 also requires VC-05's hall contract.
- VC-11 through VC-14 may run in parallel after V2 if OpenAPI registry ownership is
  coordinated; VC-15 waits for their lifecycle/media surfaces.
- VC-18 through VC-21 may run in parallel only after VC-17 publishes the exact digest.
- Stop and return to the project owner if a task needs a new price unit, shift code,
  capacity exception, editable published version, reusable table ID, public Storage
  bucket, new provider, Couple mutation, hard deletion, or different retention policy.
- Stop and split a task before work if it exceeds five human-authored files, combines
  unrelated catalog aggregates, or changes backend and Management Web in one slice.

### 17.6 Fast-track amendment from VC-08

The project owner approved this amendment on 2026-10-05. VC-05 through VC-07 were
already in progress and are not replanned. VC-08 through VC-23 retain their identifiers,
requirements, dependency order, focused proof, and safety constraints, but execute as
continuous waves:

| Wave | Scope | Execution rule | Full gate |
| --- | --- | --- | --- |
| FT-V2 | VC-08 → VC-09 → VC-10 | Continue automatically when each dependency and focused proof is green. | V2 backend service/provider gate |
| FT-V3 | VC-11–VC-14 plus VC-16 where non-overlapping → VC-15 → VC-17 | Coordinate shared OpenAPI ownership; do not pause between green tasks. | V3 backend/contract/digest gate |
| FT-V4 | VC-18–VC-21 where non-overlapping → VC-22 → VC-23 | Begin only from the frozen VC-17 digest. | V4 cross-repository acceptance and owner approval |

During a wave, each task runs only its focused behavioral proof, changed-file formatting,
and diff checks. Full unit/integration/coverage, lint, typecheck, build, migration,
generation, dependency audit, and drift commands run once at the owning checkpoint,
unless a focused failure makes an earlier complete run necessary. On this Windows host,
the stable complete integration command is
`npm run test:integration -- --maxWorkers=1`.

A green V2 or V3 gate authorizes immediate continuation. Return to the project owner
only for a failed checkpoint, an existing Section 17.5 stop condition, unsafe overlap,
or a new product decision. V4 keeps its explicit owner-approval requirement.

## 18. Fast-track planning protocol for SPEC-03 through SPEC-11

Beginning with `booking-lifecycle`, specifications are compact delta specs over the
already approved platform contracts and active `WEDDING-CONTRACT-1@1.1.0`. They must declare
that baseline version, list produced/consumed contracts and events, and must not repeat established environment,
HTTP/error, RBAC, audit, idempotency, pagination, migration, Storage, observability, or
secret-handling rules unless the module intentionally tightens one.

Drafting may overlap, but final approval follows `03 → 04 → 05 → 06`, then
`07 → 08 → 10` in parallel with `09`; `11` waits for both branches. Parallelism is
optional, not a target that overrides review capacity, file ownership, migration
ordering, or integration safety.

### 18.1 Wave budgets

| Module class | Modules | Planned waves |
| --- | --- | --- |
| High-risk state/money/media | `booking-lifecycle`, `payments-billing`, `invitation-studio` | At most 8 |
| Product workflow | `guest-rsvp`, `seating-plan`, `staff-operations` | 4–6 |
| Operations/reporting/release | `notifications-automation`, `analytics-dashboard`, `release-demo` | 4–6 |

Every wave owns a coherent vertical outcome and keeps its detailed microtasks as
acceptance checklists. Microtasks do not become separate approval gates or trigger a
complete repository suite. A module normally uses these outcomes: decision/contract
lock, persistence/domain, services/authorization, HTTP/OpenAPI, independent clients,
and final acceptance; high-risk modules may split persistence, external providers, or
concurrency into additional waves within the budget.

### 18.2 Verification and continuation

- Focused tests and changed-file format/diff checks run inside each wave.
- Full repository gates run once at the module contract checkpoint.
- Clean migrations, deterministic seed, critical E2E, security/redaction, and evidence
  run once at final module acceptance.
- Independent aggregates or clients may proceed concurrently only after their provider
  or OpenAPI surface is stable and their worktrees/files do not overlap.
- Green waves continue without another owner round-trip. Stop only for a new business
  decision, dependency reversal, money/auth/history/schema safety exception, failed
  checkpoint, or final owner approval.

### 18.3 Rolling-plan rule

After a SPEC decision gate is approved, record its compact implementation waves in
`tasks/todo.md`; plans for separate approved SPECs may be prepared concurrently.
Reference the baseline and existing platform decisions instead of duplicating them,
and record microtasks beneath their owning wave. Execution order follows provider
readiness, not the physical order of checklist entries. Prisma migrations remain in
one serialized backend lane, and money, access promotion, immutable snapshots, and
end-to-end acceptance cannot be closed using fakes alone.

## 19. Approved implementation hand-off amendment and initial ownership

The owner requested clearer team implementation contracts on 2026-10-06.
[Team implementation](../docs/team-implementation.md) defines CONTRACT_READY,
ISOLATED_READY, PROVIDER_READY, INTEGRATION_READY, and ACCEPTED. The nine module
specifications and additive baseline 1.1.0 Section 21 are approved; existing
1.0.0/CP/IA/VC records remain historical acceptance evidence.

Independent implementation permits approved non-overlapping module slices to be coded
concurrently using conforming provider fakes. Specific verified real provider methods
can unblock consumer integration before the provider's clients are all finished.
SPEC/plan approval and real-provider integration/acceptance remain distinct gates.

Each SPEC contains a parallel matrix, proposed bounded waves, DTO/request semantics,
local defaults, stable failures and requirement proof. Proposed waves are planning input;
insert execution tasks through Section 18.3 only after module SPEC/plan approvals.
No implementation task is completed by this documentation.

One shared lane owns core outbox/unit-of-work, additive identity/venue prerequisites,
Prisma migrations, OpenAPI/digest and composition-root wiring. Module owners stay within
their assigned files/branches and import only owner application ports.

Approval evidence (2026-10-06): the project owner replied, “vậy tôi duyệt draft trên”,
after reviewing the revised contract package and the three-person allocation. Active
revision is `WEDDING-CONTRACT-1@1.1.0`; documented numeric defaults are now locked.
This approval is not retroactive reopening of CP/IA/VC and does not approve unprepared
module implementation plans, complete runtime tasks, or authorize deployment.

Initial owner roles: A owns SPEC-03 then SPEC-04; B owns SPEC-05 then SPEC-06;
C owns SPEC-07 then SPEC-08. Their bounded plans may be prepared concurrently.
After individual plan and contract-artifact approval, isolated slices may overlap;
real integration waits for specific provider readiness, not every upstream client screen.
Names and one integration steward must be selected before shared-file concurrency;
SPEC-09 through SPEC-11 ownership is deferred to the next allocation round.
See the team guide Section 8 and task Checkpoint CB2 for the recorded approval scope.

## 20. SPEC-05/06 bounded implementation plan and readiness review

Prepared: 2026-10-08. Status: **Reviewable draft — no implementation-plan approval or real-provider readiness claimed**.

The user assigned SPEC-05/06 and requested completion of implementation preparation. The working branch is `huy/spec-05-06`, chosen explicitly by the user. Baseline remains `WEDDING-CONTRACT-1@1.1.0`. Existing CP/IA/VC approvals and SPEC-03 through SPEC-11 approval records remain intact.

The detailed acceptance microchecks, all28 MED/GST/PRN/QRC requirements and19 related ports are in [the implementation guide, Section14](../docs/spec-05-06-implementation-guide.md). The preparation tasks below do not authorize edits to another module owner's implementation, unsafe concurrent shared-file changes, deployment or paid providers.

### 20.1 Scope, paths and owners

- B owns `src/modules/invitation-studio/`, `src/modules/guest-rsvp/`, their tests and approved client feature slices. These backend module folders do not yet exist in this checkout.
- The steward reserves/serializes Prisma schema/migrations, core outbox/UoW, identity/venue prerequisite adapters, composition-root wiring, OpenAPI publication, seeds and scripts. B supplies reviewed fragments/wiring requests.
- A provides Booking and Payments; C integrates Seating/Staff. Notifications supplies the Guest-owned delivery adapter. Named colleagues/steward and SPEC-09 ownership are not selected by this draft.
- Client checkouts were added and audited on 2026-10-08 at sibling paths `../wedding-web`, `../wedding-manage-web`, `../wedding-app`: all13 project Markdown files,3 API locks, manifests, generators, CI and relevant source locations. See guide Section20 for source hashes/snapshots and remaining client tasks. This static audit does not prove builds or integration pass.
- Slice scope stays at most five human-authored files; generated artifacts tracked separately. Pure domain/UI fixtures may overlap unfinished providers only after the relevant plan/contract gates; real integration waits for specific verified methods, not every upstream screen.

### 20.2 Preparation and readiness gates

| Gate | Required evidence | Current result |
| --- | --- | --- |
| B-P1 — document/requirement completeness | Source inventory/hash/snapshot,28 requirement rows,19 port inventory,14 detailed waves | Document package prepared; verification recorded in guide. |
| B-P2 — decisions and API hand-off | Exact paths/schemas/errors/retry/secret responses, capability/retention decisions, owner review | Reviewable proposals below; business/security decisions not approved. |
| B-P3 — coordination and clients | Named steward/reviewers, migration reservation, actual client docs/locks | Client audit recorded in guide20; all3 locks differ from current BE artifact. Steward/reviewer/reservation evidence remains open. |
| B-P4 — execution-plan approval | Owner record approving bounded plans and resolved decisions; fake/real conformance package | No approval of this new plan recorded. |
| B-I1 — isolated implementation start | B-P4 and CONTRACT_READY for the relevant slice; conforming fakes; unwired/disabled feature | Do not claim ready merely from this draft. |
| B-I2 — real integration start | Owner commits/migrations/schemas/conformance, UoW enlist/locks, runtime API artifacts | Booking/Payments/UoW/required venue additions not found locally. |
| B-A — complete acceptance | Actual provider/clients/DB races, all requirements, clean migrations/seed, owner review | Not implemented; no acceptance claimed. |

### 20.3 SPEC-05 — eight bounded waves

| Task | Outcome | Real dependency / completion evidence |
| --- | --- | --- |
| IS-W1 | Private media, cutoff/quota, persistence and authorized originals | Current Identity+confirmed Booking+Storage; validated uploads, quota/cutoff/race/history proof. |
| IS-W2 | Templates, structured immutable designs, AI and Web/App field boundaries | Existing Storage/AI contracts; validation/ownership/PII/offline provider proof. |
| IS-W3 | Stable generic public invitation/derived publication/QR and publication reader | Current access/Booking; implemented committed public API before Guest wiring. |
| IS-W4 | Printable registry/history/proof/equal-revision precedence | Core UoW, Booking timeline/planning, Venue lifecycle adapter, Seating contracts; rollback/lock/race proof. |
| IS-W5 | Quote/approval/charge-credit/cancel-replacement/production/handover | Real BillingReader/charge/credit and effective timeline; exact immutable capture and money idempotency. |
| IS-W6 | Strict HTTP/OpenAPI, due/report ports and provider checkpoint | Runtime routes/owner schemas, real conformance, fenced reporting and generated artifact SHA/digest. |
| IS-W7 | Couple Web/full editor, App text quick-edit, Manager operations and public renderer | Actual client docs/locks/network APIs; browser/device/privacy/accessibility and client gates. |
| IS-W8 | Requirement acceptance and downstream hand-off | PostgreSQL empty+upgrade/seed/races, real E2E/clients/security, proposed evidence `tasks/evidence/invitation-studio.md` and owner acceptance. |

Each row expands through guide14.5. PRN-006 stays Payments-owned but is a mandatory real integration check in IS-W5/8. No live Seating repository read is introduced. New print approvals recheck headcount/revision, active venue/capacity and stored proof within the booking unit-of-work, even before an asynchronous invalidation arrives.

### 20.4 SPEC-06 — six bounded waves

| Task | Outcome | Real dependency / completion evidence |
| --- | --- | --- |
| GR-W1 | Stable groups/households, normalized identity, atomic preview/import/history | Identity+confirmed Booking contracts; constraints/defaults/archive/import/privacy fixtures. |
| GR-W2 | Personalized credentials/exchange/scoped RSVP/deadline/reissue | Real InvitationPublicationReader before integration; hash-only/scoped/privacy/rate/expiry proof. |
| GR-W3 | Ordered attendance plan, search, due/report and delivery hand-off | Real Booking UoW/Synchronizer, Staff facade and Notifications credential adapter where used. |
| GR-W4 | Strict HTTP/OpenAPI and provider checkpoint | Exact DTOs/errors/retry schemas, fake-real conformance, committed runtime API SHA/digest. |
| GR-W5 | Couple/Guest Web and affected Manager workflows | Actual client instructions/API locks; real import/RSVP/token/deadline/pending UX proof. |
| GR-W6 | Requirement acceptance and downstream hand-off | Real headcount→Seating→Invitation invalidation, PG migrations/seed/races/security/clients, proposed evidence `tasks/evidence/guest-rsvp.md` and owner acceptance. |

Each row expands through guide14.6. Guest plan activation and Booking headcount synchronization are one transaction; staged503 HEADCOUNT_SYNC_PENDING does not activate a plan or count as completed integration. Manual authorized share is possible before Notifications adapter readiness; automated delivery acceptance remains explicitly pending.

### 20.5 Reviewable HTTP completion proposals

These are **proposed transport details**, not implemented routes or new approved semantics. Existing SPEC paths and policies remain authoritative. Strict schemas/errors/OpenAPI must be published before client network integration. All paths below are resource paths under the actual API version prefix; no `/api/v2` is introduced.

| Missing operation | Proposed resource path | Actor / mandatory semantics |
| --- | --- | --- |
| Media list/detail/original download | GET `/bookings/{id}/media`, GET `/bookings/{id}/media/{assetId}`, POST `/management/bookings/{id}/media/{assetId}/download-links` | Own FULL/authorized Manager; download link only for authorized original use; no arbitrary key/public original. |
| Media policy read/change | GET `/bookings/{id}/media-policy`, PATCH `/management/bookings/{id}/media-policy` | Couple read; Manager audited cutoff/policyRevision command, expected revision/intent; not a mutation bypass. |
| Invitation list/detail | GET `/bookings/{id}/invitations`, GET `/bookings/{id}/invitations/{designId}` | Own FULL/Manager, bounded cursor/exact ownership. |
| Template library | GET `/invitation-templates`; Manager GET/POST/PATCH `/management/invitation-templates[/{templateId}]` | Authorized template workflows; structured content/asset validation; not arbitrary HTML. Exact template schema/version lifecycle still requires owner hand-off. |
| AI request | POST `/bookings/{id}/invitation-image-generations` | Own FULL; bounded approved prompt/one output; durable intent, UNKNOWN/reconciliation, no automatic paid retry. |
| Unpublish | DELETE `/bookings/{id}/invitations/{designId}/publication` | Own FULL/authorized Manager, revision/intent; concealed public404 and preserved history; event representation reviewed. |
| Print list/detail | GET `/bookings/{id}/print-orders[/{orderId}]`; Manager GET `/management/print-orders[/{orderId}]` | Bounded private list, quote/accepted history/status; no client-authoritative totals. |
| Cancellation intent | POST `/bookings/{id}/print-orders/{orderId}/cancellation-intents` | Own Couple records explicit confirmation bound to current order/commercial revision; secret-free durable replay. Not automatic approved cancellation. |
| Cancel request/quote / approved order | POST `/bookings/{id}/print-orders/{orderId}/cancellation`; POST `/management/print-orders/{orderId}/cancellation` | Before approval own Couple/Manager, no charge; approved only Manager/pre-production with Couple confirmation and accepted billing credit. |
| Replacement proposal/approval | POST `/management/print-orders/{orderId}/replacement-proposals`; POST `/bookings/{id}/print-orders/{orderId}/replacement-approvals` | Manager proposal+renewed Couple approval before production; new full charge/old credit atomic or pending with production blocked; preserve old effective revision. |
| Household archive | POST `/bookings/{id}/households/{householdId}/archive` | Own FULL/Manager; revision/intent, zero contribution after atomic plan sync, preserved attendance/history. |
| Import preview/commit | POST `/bookings/{id}/households/imports/previews`; POST existing `/bookings/{id}/households/imports` | Preview allowlisted rows/limits; commit exact preview digest/externalRowKey/expected aggregate version+intent; entire batch atomic. |
| Guest export | GET `/management/bookings/{id}/households/export` | Manager private export; explicit allowlisted columns/safe formula handling; format/limits/retention still require decision, not inherited from Analytics. |
| Deadline read/change | GET `/bookings/{id}/rsvp-policy`; PATCH `/management/bookings/{id}/rsvp-policy` | Own Couple read; Manager audited deadlineRevision before delivery and near-event exception; no environment override of approved default. |
| Personalized reissue/revoke | POST `/bookings/{id}/households/{householdId}/personalized-invitations/reissues`; DELETE `/bookings/{id}/households/{householdId}/personalized-invitations/{invitationId}` | Own FULL/Manager; old token revoked atomically, safe retry semantics and explicit delivery intent; no raw secret in durable replay/logs. |

For each path finalize input/output schemas, all required/nullable fields, revision references, error/status cases, audit allowlist, authorization, cursor/limits and retry safety. Existing SPEC routes retain their exact field names; these proposals do not silently extend roles, expose private originals, allow post-cutoff writes, alter printable history or authorize payment/refund ownership changes.

### 20.6 Decisions requiring explicit resolution

| Decision | Reviewable proposal / fixed boundary | Why not automatically approved |
| --- | --- | --- |
| B-D1 — Guest capability | Proposed opaque purpose-separated random32-byte capability, hash-only storage,15-minute lifetime capped by underlying invitation expiry; obtain a new capability by token exchange subject to existing throttles. It cannot outlive token revocation/expiry and never grants account roles. | Capability lifetime/transport/storage mechanism is not fixed in approved SPEC; verify crypto purpose/infrastructure and owner authorization before adopting.15 minutes is a proposal, not an approved numeric default. |
| B-D2 — secret issue/exchange retry | Proposed intent registry stores canonical secret-free resource/outcome references; encrypted short-lived one-time delivery/share material at privileged boundary where necessary; UNKNOWN retains same intent/credential revision. Retries must not create a second token or put plaintext secrets into HTTP replay persistence. | Exact authorized share recovery/replay contract needs security review and conformance. Do not promise redisplay of a lost secret without an approved mechanism. |
| B-D3 — PII retention/erasure | Use a field matrix for name/phone/email/note/images/design personal content; purpose/access/terminal trigger/holds/history/backup/export/deletion. Current-state operational contacts must not become permanent report copies; revoke/purge credentials by existing expiry/delivery rules. | Sources do not supply all Guest/media retention durations. No arbitrary duration is filled in; financial/print/attendance historical references and erasure must be reconciled before production readiness. |
| B-D4 — unpublish/deadline events | Preserve frozen event fields and completed-fact meaning. Proposed unpublication-specific additive event after schema review, rather than making existing publishedRevisionId nullable silently; reviewed deadline policy change facts/reference revision for scheduler recheck. | New event payload/version and consumer impact must be reviewed; do not emit invented events from code first. |
| B-D5 — export and template details | Publish exact column/PII allowlist, download authority, file/row limits, formula-safe encoding, export retention; define template DTO/version/history and Manager boundaries. | Product scope establishes workflows but not every numeric policy/DTO. Do not copy Analytics limits or invent destructive retention. |

Business/security/history changes follow the approved source hierarchy and change-control process. Routine compatible transport details can be selected within scope and tested; no per-microtask approval ceremony is introduced. These proposals are separated from approved SPEC values such as upload25 MiB, cutoff−72h, quote7 days, import5 MiB/1.000 rows and RSVP−7 days.

### 20.7 Verification, evidence and definition of ready

Focused checks inside waves; full backend quality/coverage/integration/contract/OpenAPI/build/audit at module checkpoint; affected client gates, empty+upgrade migration/seed rerun, real money/access/headcount/snapshot/credential races and security at acceptance. See guide14.9 for commands and28-row trace matrix; old CP/IA/VC test totals are historical only.

**Ready for isolated coding** means approved bounded plan, resolved decisions affecting that slice, CONTRACT_READY and conforming doubles. **Ready for all real integration** additionally requires actual upstream methods/migrations/UoW/lifecycle locks, exact owner artifacts/conformance, actual client docs/locks and working credential adapter for automated delivery. Full acceptance still requires implementation and owner-reviewed evidence. A completed document checklist cannot satisfy these runtime gates.

### 20.8 Client audit and remaining implementation work

- All3 clients pin backend commit `168f61dd16fa58760b0d6238b7ebfd73503471c7` / SHA-256 `cc57e41c60f5e8e4edf9c5c835f986a7e4b17bfd64bbb3853888b29a9968ff40`; current BE OpenAPI has digest `caad010d6008cbfc8fc0748f49abad0c651e85ccda5cf008b60ac3f4e6fa3dc5`. Their default local generator will reject this mismatch. Preserve immutable lock semantics; publish implemented contract, then update each lock and regenerate types. Do not bypass digest checking or hand-edit generated files.
- Public Web currently has Identity/Booking feature code; Management Web additionally has Venue code; App has Identity/Booking API code. No Invitation Studio/Guest RSVP feature folder or generated05/06 path/schema was found. Existing account/workspace invitations are not household invitations.
- Add reviewed feature slices under each client `src/features/invitation-studio/` and `src/features/guest-rsvp/`. Web routes live under `app/`; Android routes under `src/app/`. New route names remain proposals until contract/UX review. Guest capability and public invitation views belong to Public Web; App is Couple-only; management operations must enforce Manager scope in BE.
- Keep Guest capability state separate from account sessions and workspace/reset credentials. Web command retry helpers currently include Authorization/body in an in-memory signature; design a secret-free05/06 intent registry rather than persist or copy this representation into durable storage. Existing generic client expects JSON except204/205: use a reviewed separate binary-transfer path for direct uploads/downloads/exports where required, preserving signed URL expiry and error handling.
- Web checks: formatting/lint/typecheck/api:check/coverage/build/audit. Android adds Expo SDK health and local Android export; this export is not an APK or EAS release. Validate real Guest/Manager/Couple flows, accessibility, responsive sizes and Android behavior at the implementation checkpoint; no runtime checks were executed in this documentation audit.
- Next.js AGENTS instructions require reading installed version documentation before client code. Client source now pins Next16.3.8 while historical baseline evidence names16.3.6; record reviewed dependency drift instead of silently changing versions. Local Node is25.2.1, whereas repositories require Node24.x (`.node-version`24.21.0); no client node_modules is present. Prepare the required runtime/locked install before execution gates.

### 20.9 SPEC-05 W1 isolated implementation checkpoint — 2026-10-08

Historical checkpoint. Current W1 implementation status is Section20.12/20.13 and SPEC-05§11; pending items below describe this earlier state.

The user explicitly requested starting SPEC-05 wave1 against the related documents. This authorizes the bounded isolated media implementation on `huy/spec-05-06`; it does not resolve unrelated B-D1…B-D5 decisions or approve the remaining waves/release. Source: SPEC-05§1/5/6/7/9/10, MED-001…006, ACC-004, baseline access/storage boundaries and team implementation independent-slice/shared-file lanes.

Five human-authored implementation files were added under `src/modules/invitation-studio/`: application contracts/service/tests, domain media policy and an explicitly non-durable memory repository double. There is no composition-root, Prisma schema/migration, OpenAPI, provider-owner or client change.

- Implemented strict private original upload/replacement/metadata/tombstone commands; generated content-addressed keys through existing StorageProvider; immutable file revisions, accepted checksum/type/bytes/dimensions, cutoff/policy snapshot and recoverable upload-attempt reference. Caller bytes are copied before async work. URLs never enter accepted records/audit.
- JPEG/PNG/WebP magic/MIME and25MiB validation reuse Core Storage. Full decode is a required injected `MediaImageInspector` contract; decoded dimensions enforce1…12000 and40million pixels. The test inspector is a double, NOT production image-content validation. No header-only production decoder was introduced.
- Booking-serialized active quota100/1GiB, CAS, same-command replay, rollback-safe replacement, cutoff before AND after provider upload, current access recheck and15-minute authorized original URLs. Manager reads after cutoff and changes cutoff explicitly with before/after audit; Couple owns mutations. Detach/replacement preserve every accepted historical object with no automatic Storage.delete.
- State/receipt/lifecycle audit must commit atomically; access denials and upload attempts survive failed acceptance. Attempts link command digests and accepted file revision IDs for recovery. Pending uploads do not count as accepted quota. Unknown/unreferenced uploads remain private pending steward recovery; no destructive orphan deletion is assumed.

**Validation:**42 W1 tests +25 existing Storage tests +9 targeted Venue tests pass (76); focused media coverage100% lines/92.85% branches. Final offline unit suite:49 files/667 tests pass. An earlier unit-suite run had a Venue pagination failure; targeted rerun and final suite passed. That existing test shares a `mockResolvedValueOnce` across parallel hall requests; this checkpoint does not edit Venue. Typecheck/build/module lint/format results are recorded in guide18.4. Checks ran with existing Node25.2.1, not the required Node24.21.0, so pinned-runtime acceptance remains pending.

**Persistence/steward hand-off still required before W1 closure:**

1. Persistent booking policy (revision/cutoff/history), asset active pointer/tombstone, immutable accepted file metadata/storage reference/uploadAttemptId, command receipt (actor+key+digest+safe result), redacted lifecycle/denial audit and pre-provider upload-attempt journal. All business IDs UUID; no upstream table ownership or signed URL persistence. No retention duration is invented; agreed invitation/design/print/display use and referenced history are retained pending reviewed erasure/holds policy.
2. One real PostgreSQL booking lock shared across repository instances, policy/quota/CAS mutation, transactional file/receipt/audit acceptance; immutable file IDs/history and unique command intent. Journal must durably commit independently BEFORE external upload, remain after acceptance rollback, and reconcile by intent digest/file uploadAttemptId. No blind content-addressed-key delete. Empty+upgrade migration/rollback/concurrent-quota/crash tests are required in the steward lane.
3. Actual current Identity/FULL-own-booking/Manager and CONFIRMED Booking guard, authoritative absolute event-start resolver with restaurant timezone/shift semantics, and access-revocation/booking-state locks that remain effective through commit. Local port declares these obligations; its fake cannot prove them. No client-provided event start/access claims.
4. A reviewed complete JPEG/PNG/WebP decoder with decompression/frame bounds, real malformed/truncated payload fixtures and Core Storage real-adapter conformance. No dependency or SDK was added outside the shared lane.
5. Runtime multipart/HTTP hand-off: authenticate before parsing, exactly one file <=25MiB, strict approved fields, bounded body/field/memory/concurrency/rate policies, expectedRevision+Idempotency-Key and stable errors. Mount dedicated multipart route without weakening the global1MiB JSON/security policy. Original download/preview and bounded lists need reviewed DTOs/routes and redacted logging. HTTP/OpenAPI/wiring belongs to IS-W6/steward; none is advertised as available now.

Status: **isolated application/domain proof only**. IS-W1 remains unchecked until persistence, full decoder, real access/Storage conformance and runtime hand-off evidence are supplied. Entire SPEC-05 is not accepted.

### 20.10 SPEC-05 W1 continuation — checked implementation, real integration still open

Historical checkpoint. Current W1 implementation status is Section20.12/20.13 and SPEC-05§11; pending items below describe this earlier state.

The user's request to implement wave1 and check completed tasks authorizes this continuation on `huy/spec-05-06`. Section20.9 records the earlier five-file checkpoint; its pending decoder/persistence items are superseded below. Unrelated B-D1…B-D5 and later waves remain unresolved.

Changes were developed as serial small slices: decoder/dependency (package manifest/lock + inspector/test); persistence (schema + new migration + repository + integration test, with service receipt-key hashing); current Identity guard/context; bounded HTTP factory/tests. Shared package/schema changes were serialized in this branch. No teammate approval or steward hand-off is fabricated, and upstream Booking tables/modules were not implemented in this lane.

- Complete local pixel decoding uses sharp0.35.5 with strict warning rejection, all-frame40million-pixel budget,12000 per-frame edge,25MiB input, bounded concurrency and10-second native processing timeout. Uploaded originals retain their bytes. Metadata alone is insufficient: raw pixel materialization is tested with real JPEG/PNG/WebP, malformed/truncated and animated fixtures. Decoder documentation: https://sharp.pixelplumbing.com/api-constructor/ , https://sharp.pixelplumbing.com/api-input/ , https://sharp.pixelplumbing.com/api-output/ .
- Six owner tables and migration `20261008000000_invitation_media` persist policy, asset pointer/tombstone, immutable file revisions, hashed command receipts, append-only audit and pre-upload journal. Same booking advisory lock serializes multiple repository instances; deferred same-booking/current-file FK and quota constraints validate atomic acceptance at commit. Journal uses a separate connection and commits before Storage.put; pool must support at least two connections. Recovery is read-only with bounded pages, never destructive orphan deletion.
- PostgreSQL tests cover cross-instance replay, concurrent quota/CAS, deferred commit failure/rollback with surviving journal, retry reconciliation, retained history and DB rejection of immutable file/receipt mutations. Real Identity account/session/resolver/FULL access is tested for revoked/disabled/restricted/Staff state and Manager read after cutoff. Bearer tokens are ephemeral context only and excluded from receipts/audit.
- The unmounted HTTP factory authenticates and checks own booking before allocating multipart buffers. It enforces one file,25MiB/file, complete request25MiB+64KiB including chunked preamble, strict fields, bounded uploads through decode/storage, required idempotency/CAS and no-store private reads. Existing global JSON1MiB/security/rate/deadline policies remain effective. HTTP tests include valid images above1MiB and parser rejection/race cases.

**Focused proof:**72 tests pass on pinned Node24.21.0 with disposable native PostgreSQL18 at127.0.0.1:55471; media coverage98.91% lines/94.27% branches, per-file80% thresholds pass. Database helpers create and drop their own temporary databases. Migration deploy on an empty disposable database succeeds. Full regression/build/lint/format/API/audit gate results are recorded in the latest checkpoint after completion. No configured shared database or paid Storage/AI service is used.

**Still required for W1 completion:** actual baseline BookingReader plus authoritative approved calendar/timeline event start; shared Booking/access-revocation locks through commit; media acceptance with actual Storage adapter; composition-root wiring and reviewed HTTP/OpenAPI/provider checkpoint. Current guard can consume real Identity but its Booking/calendar tests remain doubles. Repository currently hydrates booking history/receipts/audit for its callback; assess bounded query/load behavior before production wiring. Recovery UUID cursor pages enumerate the currently stored set; repeat a full reconciliation scan to include concurrently inserted attempts with lower random IDs. Production retention/erasure work stays governed by approved holds policy. Therefore IS-W1 is not fully complete and SPEC-05 is not accepted; individual completed items are checked in tasks/todo B-EXEC.

**Final regression,2026-10-09:**83 files/800 tests pass with all database URLs explicitly set to disposable PostgreSQL; no DB suites skipped. Full backend coverage97.18% lines/92.50% branches passes per-file80% gate. Typecheck/build/lint/format/API check pass; dependency audit accepts only existing two documented, unexpired exceptions. An initial full run failed the pre-existing parallel Venue pagination fixture: one-shot `listActiveHalls` mock was consumed by concurrent list/detail/cursor requests. A separate one-file test repair uses a stable snapshot for all calls; full regression then passes. Production Venue remains unchanged. Empty deployment and schema-isolated migration-policy tests include the new migration. Temporary PostgreSQL is stopped after verification; no shared database deployment or release approval is implied.

### 20.11 SPEC-05 W1 completion audit — 2026-10-09

Historical checkpoint. Current W1 implementation status is Section20.12/20.13 and SPEC-05§11; the missing-adapter observations below predate the native read-side prerequisites.

The user requested completing wave1 while checking related documents. Rechecked SPEC-05§1/4–7/9–10, MED-001…006/ACC-004, baseline§4/6.3/21.1/21.2 and the cross-owner transaction rules, SPEC-03 local-date/effective timeline rules, SPEC-venue local shift conventions, team implementation§1/4/5/6 and migration/cross-repo guidance. W1 is media validation/cutoff/quota/storage; explicit derived publication remains W3, HTTP publication/provider checkpoint remains W6. Fake-only access is not W1 completion evidence.

Completed serial module slices:

1. Approved event-start consumer (four files): guard forwards trusted request context; media timeline projection resolves the exact `effectiveTimelineRevisionId` with baseline request/actor authority, requires mutually approved/effective matching booking/date/shift, validates local date/HH:mm, converts using Asia/Ho_Chi_Minh, and tests midnight/leap-day/stale/mismatch/missing provider. It does not replace Booking's owner port or invent shift times. Reader implementation exists; actual upstream provider is absent.
2. In-flight intent semantics (five source files + a separate focused test slice): repository takes a nonblocking command advisory lock before booking serialization. Same intent during full decoding/provider work yields409 REQUEST_IN_PROGRESS+Retry-After; completed identical intent replays without decoding again. Different commands retain serialized booking quota/CAS. Memory double models the same behavior. No new business schema or applied migration is changed.
3. Production Storage adapter conformance (controlled SDK helper + media PostgreSQL tests): execute actual SupabaseStorageProvider against controlled upload/info/signed-read SDK boundaries with real decoder/DB. Validate server-scoped originals, replay,900-second private URLs, redacted persistence, retained originals, and upload-before-info-failure recovery via validated duplicate409. No external network/paid operation or live Supabase readiness claim.
4. Canonical UUID keys: normalize media booking/asset UUIDs before authority/digest/map/lock use; PostgreSQL lock IDs canonical too. Test uppercase booking/asset inputs replay the same accepted asset and command receipt.

**Required external hand-off to close W1:**

| Missing executable dependency | Frozen source | Evidence required |
| --- | --- | --- |
| Actual BookingLifecycleReader.requireBookingAccess/requireConfirmedEventContext | baseline§6.3, SPEC-03, SPEC-05§4/10 | Committed owner adapter+migration; FULL own consultation/confirmed deposit, Manager context, revoked/nonconfirmed/other-booking denial. |
| Actual BookingTimelineSnapshotReader.resolveApprovedRevision | baseline§21.2, SPEC-03 | Committed approved/effective immutable timeline snapshot; bind existing media event-start consumer. |
| Core/owner scoped UoW with booking/state/access locks | team§5, baseline transaction context | Owner writers coordinate the same locks; revocation/cancellation versus media acceptance race and rollback proof. Current Identity resolver rechecks do not establish this guarantee. |
| Composed media runtime/API hand-off after real prerequisites | SPEC-05§9–10, team provider states | Real Booking/Identity/Storage wired E2E, reviewed DTO/list/download and generated API checkpoint. No fallback success or fake confirmed state in production. |

`src/modules/booking-lifecycle/` and actual shared Booking UoW are absent in current checkout; local/remote-tracking branches show no Booking implementation checkpoint to reuse. Asked the user for the source branch/repository containing these provider implementations. Implementing a local table seeded as CONFIRMED would invent deposit truth and violate ownership; it cannot satisfy the above evidence. W1 remains incomplete because of these dependencies; completed consumer/storage/retry checks are ticked in todo. All historical checkpoint metrics above remain historical; latest validation is recorded below after gates finish.

**Latest gate:**84 files/820 tests (92 media tests) pass on Node24.21.0 with explicit disposable PostgreSQL18 URLs; no database suites skipped. Full coverage97.18% lines/92.54% branches passes per-file80%. Typecheck/build/lint/format/API check pass; dependency audit retains the two existing approved exceptions only. Source manifest still contains37 BE Markdown+one JSON;54 BE/client snapshots and12 client technical hashes are verified after the checklist changes. Temporary PostgreSQL is stopped after tests. No production root routes, published OpenAPI or client contract pins change in this continuation.

### 20.12 SPEC-05 W1 remaining-work implementation — 2026-10-09

The user's “kiểm tra thật kĩ và làm hết các phần còn thiếu cho tôi” authorizes the missing W1 repairs and the limited owner/Core prerequisites needed to exercise them. Sections20.9–20.11 are historical. The scope remains media, cutoff, quota, private originals, persistence and recovery. Full SPEC-03/04 payment/booking workflows, IS-W2…8, SPEC-06, external API publication and deployment are not accepted by this checkpoint.

**Implemented and verified:**

| Previous gap | Completed change and executable evidence |
| --- | --- |
| Same key/different body while pending incorrectly returned409 | Independently committed immutable `InvitationMediaCommand` binds actor-scoped intent to body digest before decoding/provider work. Mismatch returns422 during pending, after commit and after acceptance rollback; identical pending intent returns409/Retry-After, completed identical intent replays. Memory and PostgreSQL tests cover these behaviors. |
| History/receipt/audit loaded without a working-set bound | Prisma acceptance loads at most101 active assets/current files (rejects an invalid persisted count), only the current command's receipt, and no historical audits. Historical file/receipt/audit rows stay immutable in PostgreSQL. Metadata-history and detach tests prove bounded hydration and retained history. |
| UUID recovery cursor could miss later smaller IDs | Upload journal has an insertion sequence; bounded pages order by it. `recoverySweep` starts from zero on each sweep, so late commits are reconsidered rather than hidden behind a permanent watermark. Lower UUID insertion, repeat sweeps and append-only journal tests pass. No object deletion is added. |
| Missing exact1GiB/concurrent byte quota evidence | PostgreSQL tests accept40×25MiB+24MiB exactly, reject one byte more at commit, and allow reuse after detach. Two concurrent one-byte claims against1GiB−1 have exactly one winner. Fixtures test DB metadata constraints without claiming a Storage upload of synthetic25MiB objects. |
| Missing populated upgrade/recovery backfill proof | Upgrade preserves existing Account/AuditLog/IdempotencyRecord and populated media asset/file/receipt/journal data. Recovery migration backfills matching accepted/pending intents and sequences. Conflicting historical body hashes stop the migration; a rolled-back conflict rehearsal proves it does not silently rebind an intent. |
| No executable shared Core scope | `src/core/database/booking-boundary.ts` supplies baseline21.8 `BookingBoundaryUnitOfWork`, booking mutex, same transaction enlistment, trusted opaque scope and exact booking/actor/request/causation binding. Forged/expired/crossed/omitted scopes and unscoped nested transactions are rejected. Authenticated media is supported; system commands still require their own purpose-allowlisted facade. |
| Current Identity changes not held through commit | Identity-owned `authorization/scoped-identity.reader.ts` locks Account, roles, Session, AccessCredential and own ConsultationAccess before current-state re-read. Token/session reparenting cannot authenticate against unlocked rows. Real concurrent disable/revoke/role removal/FULL restriction are blocked until media commit; changes winning first deny further acceptance. |
| Missing real Booking/timeline/deposit read-side adapters | Booking-owned `application/booking-readers.ts`/`infrastructure/prisma-booking.readers.ts` implement the exact media subset of baseline6.3 and full21.2 timeline DTO. Payments-owned deposit reader implements the6.4 settlement read subset. They read persisted owner rows, require CONFIRMED+matching immutable settlement, exact mutually approved/effective timeline, and own FULL consultation access. No media command creates settlement, promotes access or confirms a booking. |
| Missing composed native-provider media proof | `infrastructure/media.composition.ts` composes actual scoped Identity, Booking/timeline, deposit reader, Prisma media, native sharp decoder and explicitly supplied Storage. `media-native-providers.test.ts` exercises real owner rows/locks, production Supabase adapter with controlled SDK, lifecycle/replay/denials/Manager originals, rollback and phase/effective-pointer races. This is native read-side integration evidence, not a payment-verification or live Supabase journey. |

**Frozen source checks:** SPEC-05§4–7/9–10, MED-001…006/ACC-004; baseline§6.3/6.4/21.1/21.2/21.8; SPEC-03§7 and local calendar rules; team§2/4/5/6; migration/cross-repo rules. Approved timeline DTO requires1–100 unique ordered items, title1–120, description0–2000/null, valid local HH:mm within the immutable shift. Hall name1–120 and planning headcount0–10000 are preserved. Native confirmation reads never replace the verified Payments acceptance path or recalculate30% deposit/commercial totals.

**Serial file lanes:** core scope; Identity scope and reference-race proof; schema/forward migration; four owner read-contract/adapter files; media scope enlistment; one composition factory; bounded PostgreSQL/upgrade/concurrency proof; strict timeline DTO proof; documentation/checklist. Each logical source/test slice was kept at or below five human-authored files. Shared schema/migration/dependency changes were serialized; generated Prisma types are separate. The earlier applied migrations were not rewritten.

**Provider hand-off inventory:** Core `src/core/database/booking-boundary.ts`; Identity `src/modules/identity-access/authorization/scoped-identity.reader.ts`; Booking `src/modules/booking-lifecycle/application/booking-readers.ts` and its Prisma adapter; Payments `src/modules/payments-billing/application/deposit-settlement.reader.ts` and its Prisma adapter; consumer `src/modules/invitation-studio/infrastructure/media.composition.ts`. Forward migrations are `20261009000000_invitation_media_command_recovery` and `20261009010000_w1_owner_readers`. Conformance/upgrade/native-race evidence is in `tests/integration/invitation-studio/`; strict timeline and corrupted-settlement/reference tests are owner-local. The read-side models are prerequisites, not complete Booking/Payments aggregates, slot allocation, payment callback verification or settlement acceptance implementations. Only trusted owner writers may create verified settlement/approval facts; no production fixture/seed or fake-confirmation fallback is wired.

**Latest gate:**89 files/865 tests pass on Node24.21.0 with all three database URLs explicitly bound to disposable local PostgreSQL18 at127.0.0.1:55471; no DB suites skipped. Full coverage97.16% lines/92.87% branches meets per-file80%. Typecheck/build/lint/format/API/audit pass; audit retains only the two existing documented, unexpired exceptions. All54 BE/client snapshots and12 client technical hashes are verified after refreshing38 BE sources (37 Markdown+one JSON). Native+media focused suite passed135 tests before the two final Identity reference-race tests; full regression includes all137 W1/prerequisite tests. All six migrations deploy on the disposable database; schema diff is empty, and unique disposable database helpers exercise empty migration order plus populated upgrade. Disposable PostgreSQL is stopped after verification; no shared database was migrated.

**W1 implementation status:** completed source/service/persistence and native read-side integration checks; completed items are checked in todo and guide14.5. External media HTTP/OpenAPI/list/download DTO publication remains IS-W6, rather than being incorrectly required to finish W1. The router factory is still unmounted. No `PROVIDER_READY`, `INTEGRATION_READY` or module `ACCEPTED` label is fabricated: exact reviewed provider commit/API checkpoint, complete upstream settlement→confirmation→FULL promotion journey and full SPEC-05 acceptance remain separate hand-offs. Current branch is `huy/spec-05-06`, based on `6bb247bd6fd7e979a64f929f4a0495ea7c5a3de2`, with reviewable working-tree changes; no commit/push/deployment is implied.

### 20.13 SPEC-05 W1 closure cross-check — 2026-10-09

The user asked whether every W1 task in the related Markdown/documents was done,
and requested completing gaps or marking verified status. Reconciled the37-source
inventory, SPEC-05§1/4–7/9–10, MED-001…006/ACC-004, baseline6.3/6.4/21.1/21.2/21.8,
SPEC-03 approved timeline bounds, team§2/4/5/6, Core/Identity/Storage rules,
migration guidance and the approved W1 plan/checklist against current code/tests.
The W1 backend tasks in guide14.5 have executable evidence and no newly identified
functional implementation gap. SPEC-05§11 now maps each W1 requirement to evidence
and names remaining W3/W6/W7/upstream/full-acceptance work explicitly.

Tracking omissions corrected in five existing documents: SPEC-05 records W1 status
and its seven checked task groups; Capability Map no longer says all invitation
implementation is pending; todo records W1 authorization/native prerequisite
implementation separately from formal provider readiness; guide names static and
earlier checkpoints as historical; this plan records the cross-check. Frozen
requirements and historical test/approval facts are preserved.

Verification reuses the unchanged-source Section20.12 result:89 files/865 tests,
137 W1/prerequisite tests, no skipped PostgreSQL, all quality/migration gates passed.
This continuation changes tracking documents only; it does not claim a new test
run or alter runtime/schema/client contracts. Source snapshots/hashes and document
format/diff checks are refreshed after these edits. Formal reviewed commit/API
publication and complete settlement→confirmation→FULL-promotion acceptance remain
separate gates; they are not falsely checked as W1 code tasks or module acceptance.

### 20.14 SPEC-05 media HTTP server wiring — 2026-10-09

The user's subsequent request authorizes mounting media APIs into the server.
InvitationStudioRuntime composes native Identity/Booking/timeline/deposit readers,
the shared booking transaction, Prisma media, sharp and configured Supabase Storage.
Disabled Storage rejects provider operations with503 instead of fake success.
Bootstrap mounts at `/api/v1`, cleans earlier owner resources on composition failure
and includes the media database resource in shutdown.

The five operations are POST `/bookings/{bookingId}/media`, PATCH/DELETE/GET
`/bookings/{bookingId}/media/{assetId}` and PATCH
`/management/bookings/{bookingId}/media-policy`. Multipart limits/auth-before-buffering,
global1MiB JSON/security/rate/deadline and current owner authority are retained.
Authentication middleware is scoped to media paths; unknown query/body fields are
rejected. Safe asset DTOs expose `mediaAssetId/revision/detachedAt/previewPath`.
GET signs the current original for900 seconds/no-store; write replay contains only
the credential-free preview path, avoiding URL signing after committed acceptance.
Internal file/object/journal fields remain excluded. Shared runtime Zod schemas
generate deterministic OpenAPI plus digest for these operations.

Focused57-test proof includes native HTTP server/PostgreSQL upload/replay/read,
disabled Storage503/no accepted image, unrelated routes, startup/shutdown and
OpenAPI contracts. Venue's geometry-mutation regex now scopes to catalog paths
instead of falsely matching unrelated media descriptions across the whole document;
its global internal-storage/actor leakage assertion remains intact.

The first full-regression attempt used incorrect test variable names, allowing
DATABASE_URL/MIGRATION_DATABASE_URL to be read from `.env`; its core database
tests failed and the run was stopped, so it is not acceptance evidence. The corrected
run explicitly sets DATABASE_URL, MIGRATION_DATABASE_URL and TEST_MIGRATION_DATABASE_URL
to disposable PostgreSQL at127.0.0.1:55471. That run exposed an older Identity
fixture whose fixed access expiry had become earlier than PostgreSQL's real createdAt.
The fixture now starts at wall time with a relative event start and advances past
cutoff explicitly; this preserves denial/Manager-after-cutoff assertions without
changing the Identity/media implementation or weakening database constraints.
No shared-database migration or live Storage/AI operation is performed.

**Final gate:**91 files/875 tests passed on Node24.21.0, no database suites skipped.
Coverage97.24% lines/92.96% branches passes per-file80%. Typecheck/build/lint/full
format/OpenAPI byte+digest checks passed; dependency audit retains only the two
documented unexpired exceptions1145093/1153173. The18-test lifecycle suite also
passed after its cleanup assertion was adjusted for lint typing. Disposable PostgreSQL
is stopped after verification. New API SHA-256:
`18456142711b84fd350d8d91450e0ae33341e77623a358d00a2c497b4f8a21c4`.
This is a working-tree artifact digest; no reviewed commit/client pin is claimed.

This completes the mounted media transport subset only. Other W6 endpoints,
bounded media-list/policy reads if finalized, automation/reporting/events, reviewed
committed API/client pins and whole-module acceptance remain separate. No commit,
push or deployment is implied.
### 20.15 SPEC-05 W2–W4 implementation and verification — 2026-10-09

The user authorizes completing all three backend waves without further questions.
The scope is template/design/AI, explicit safe publication/generic QR, and printable
registry/capture with real owner readers. This does not include W5 money/fulfilment,
W7 client UI, SPEC-06 implementation or release acceptance. Shared schema, migration,
runtime, dependency and prerequisite-owner changes are serialized on `huy/spec-05-06`.

| Wave | Implemented application/infrastructure | Executable evidence |
| --- | --- | --- |
| W2 | `design.service.ts`: Manager versioned/archived templates; own FULL Couple structured designs and immutable revisions/CAS; authoritative Identity session kind limits Android to textFields. `generation.service.ts`: bounded safe prompt, configured Gemini, private fully decoded PNG, existing media quota/cutoff, independent durable generation intent, no repeated paid call for an unknown effect. | `studio-policy.test.ts`, `studio-waves.test.ts`, existing core Gemini and media suites. |
| W3 | `publication.service.ts`: exact design/publication CAS, stable opaque identity per booking, minimal immutable public projection, atomic outbox, unpublication. `derived-assets.service.ts`: separately encoded metadata-stripped PNG ≤2048 pixels/edge, own source revisions, immutable upload intent and safe exact-object retry; server-controlled public asset URLs checked against the current publication. Public JSON/escaped HTML/QR PNG and private editor/template/AI endpoints are mounted by the native runtime. | Native HTTP, same-key replay, wrong ownership/revision, provider rollback, private-field exclusion, public404, asset visibility and OpenAPI suites. |
| W4 | `printable.service.ts`: exact registry ports, immutable geometry/digest/proof, high-water, both-order equal invalidation, higher reconfirm; internal capture freezes effective approved timeline, exact design, optional eligible seating and the same generic QR. Native Booking planning/Venue eligibility readers share the Core transaction and owner lifecycle locks; no Seating repository query. | `studio-waves.test.ts`, `registry-conformance.test.ts`: same cases on consumer double/native PostgreSQL; missing/historical proof, stale exception, current in-range/out-of-range/zero counts, retirement locking, exact historical reader and owner rollback. |

Exact source contracts remain baseline1.1.0 and SPEC-05/07. The canonical seating
digest is SHA-256 of Core canonical JSON for the bounded renderSnapshot; the producer
must use that same representation. Registration also compares layout/booking/revision/
proof, so matching a claimed digest does not permit content mutation. Optional legacy
proof remains readable history; new integrated registrations/captures require proof.
An active superseded layout may remain printable; retirement and physical/hall
capacity cannot be overridden by a Manager exception. A count changed within the
inclusive layout range is still eligible without an exception; exceptions must match
the current booking revision and count exactly.

The accepted implementation choices for the source's incomplete HTTP rows are:
GET `/invitation-templates`; Manager GET/POST `/management/invitation-templates` and
GET/PATCH `/{templateId}` (optional `versionId` on detail); booking GET list/detail,
POST design/revisions/publication, DELETE design publication; POST
`/bookings/{bookingId}/invitation-image-generations` and
`/bookings/{bookingId}/invitation-derived-assets`. Reads have strict query schemas,
lists use UUID cursors/default20/max100, writes use durable Idempotency-Key and CAS.
Additional public GET paths are `/public/invitations/{slug}/render`, `/{slug}/qr`
and `/public/invitation-assets/{slug}`. All paths are under `/api/v1`.
The generic QR points to the implemented public HTML endpoint under the configured
`PUBLIC_INVITATION_ORIGIN`; it contains no personalized credential or RSVP/check-in
authority. Missing origin disables publication503; HTTPS is required except loopback
development/test. Stored booking identity/url is stable across variants and re-publish.
HTML escapes text and uses restrictive CSP; all public/authorized reads use no-store.

Unpublication emits a separate additive `invitation.unpublished` v1 fact with
`bookingId/publicInvitationId/publishedRevisionId/changedAt`; publishedRevisionId is
the last removed revision and remains non-null. The existing
`invitation.publication-changed` v1 required fields and completed publication meaning
are preserved exactly. New consumers must opt into the removal fact/re-read current
publication. Both mutations and outbox facts commit or roll back together; event
dispatch/notification consumers remain W6/owner integration work.

Migration `20261009020000_invitation_design_publication_printable` adds immutable
design/template/publication/derivative/printable/registry history, retained receipts/
outbox/intents, deferred same-owner head references, high-water checks and generation
terminal-state constraints. Seven migrations deploy on disposable PostgreSQL18 at
127.0.0.1:55471; Prisma schema diff is empty. Existing populated core/media upgrade
fixtures apply the new migration and compare their retained facts. No shared DB,
live AI or live Storage operation is used. Tests set all three DATABASE_URL,
MIGRATION_DATABASE_URL and TEST_MIGRATION_DATABASE_URL explicitly to the disposable DB.

QR uses exact qrcode1.5.4/@types1.5.6. The compatible mysql2 transitive override3.24.5
removes advisory1153173 and the newly reported compressed-protocol advisory; its
obsolete exception is removed. The existing deepmerge-ts exception1145093 remains
subject to its unchanged reviewBy date and PostgreSQL/static Prisma reachability.

**Verified implementation gate:**96 files/949 tests passed on Node24.21.0 with
all PostgreSQL suites enabled. Coverage97.30% lines/92.74% branches passes every
file's80% threshold. After adding the explicit native runtime Gemini/Storage SDK
integration and print-vs-timeline/headcount locking cases, the two native/conformance
suites passed42 tests; those additional tests do not change production code.
Typecheck/build/lint/API/audit passed.
The working-tree OpenAPI SHA-256 is
`4e60b1f7de474c13759fcd29bbdde95075de2bca60cefd1a96ae8a1e6783eed3`.
Formal PROVIDER_READY/INTEGRATION_READY still requires the reviewed exact commit,
committed API digest and consumer pins per team contract. No commit, push, deploy or
whole-module ACCEPTED status is claimed by a local implementation checkpoint.
## 20.16 SPEC-05 W2–W4 re-audit corrections — 2026-10-09

The owner requested all audit findings corrected and a complete API inventory. Scope
is backend W2–W4;19 mounted operations and internal ports are listed in
[the hand-off](../docs/spec-05-w2-w4-handoff.md). Corrected native opaque credential
filtering, template read reauthorization/denial audit, readonly registration and
shared fake/native dependency-failure conformance. Added journal-based image recovery
and Manager pending list/evidenced abandonment; no second paid AI call or automatic
timeout-based release. Valid AI output followed by Storage error remains recoverable.
Strict owner event schemas validate persisted publication/removal envelopes.

First focused check:4 files/79 tests passed. A subsequent whole-backend run passed
96 files/964 tests, but its coverage gate failed: W5 files were added concurrently,
and new W2–W4 event/recovery branches needed final coverage proof. This run is not a
green whole-backend gate. Final owned-scope checks and their exact evidence are
recorded below after completion; no skipped DB suite or live provider calls are used.

Do not claim reviewed commit/client pins, owner-approved new contract meaning or actual
Seating producer integration from local tests. Those gates remain explicitly open.

Final owned-scope proof:6 files/104 tests passed on Node24.21.0 with native disposable
PostgreSQL, no skipped DB suite and no live provider calls. Covered changed W2–W4
files:98.82% lines/94.05% branches; per-file80% passed, including shared repository
outbox serializers added by concurrent W5 work. Typecheck, build, changed-scope lint
and generated OpenAPI check passed. Logs: test-results/studio-fixes-owned-coverage.log
and studio-fixes-coverage.log. These fixes require no additional schema migration.
The current artifact/digest remains a working-tree artifact; use the file in openapi/
and an exact reviewed commit at hand-off, never the historical client digest.

Latest whole-checkout typecheck after concurrent W5 tests appeared reports four
possibly-undefined errors in tests/integration/invitation-studio/print-order-native.test.ts
(lines374/375/482/483 at that check). Earlier typecheck/build succeeded; do not report
the latest whole-checkout typecheck as green until W5 fixes these. W2–W4 final104-test
and owned coverage evidence above remain green; no W5 file was overwritten here.

## 20.17 SPEC-05 W5 (Physical-Invitation Print Orders) implementation — 2026-10-09

Wave IS-W5 implementation (PRN-001..009, QRC-001..004, baseline 21.6, guide 14.5: 05-W5) is completed and verified across all layers:

1. **Database Schema & Migrations:**
   - 6 new models in `prisma/schema.prisma`: `InvitationPrintOrder`, `InvitationPrintLine`, `InvitationCommercialRevision`, `InvitationPrintAudit`, `BookingReceivableCharge`, `BookingChargeCredit`.
   - Migration `20261009030000_invitation_print_order_and_billing` deployed to PostgreSQL.
   - Immutable triggers protect `InvitationCommercialRevision` and `BookingReceivableCharge` from updates/deletions.

2. **Payments-Billing Boundary:**
   - Contracts `BillingReader`, `BookingChargeRegistrar`, `BookingChargeAdjustmentRegistrar` implemented via `PrismaBillingAdapter`.
   - Idempotent charge recording via `registerAcceptedCharge` and adjustment via `registerCredit` preventing overcredit and conflict.

3. **Invitation Studio Domain & Application:**
   - `print-policy.ts`: 7 lifecycle states (`REQUESTED`, `QUOTED`, `APPROVED`, `IN_PRODUCTION`, `READY_FOR_HANDOVER`, `HANDED_OVER`, `CANCELLED`), strict Zod validation (1–20 lines, 1–10.000 qty/line, unit price 1–1.000.000 VND, max order total 1.000.000.000.000 VND, 7-day quote expiry, future estimated handover date).
   - Domain unit tests in `print-policy.test.ts` (11 tests, 100% pass).
   - `print-order.service.ts`: Implements all 12 use cases with atomic Core `PrismaBookingBoundary` UoW, printable snapshot frozen verification, timeline effective validation, and 3 transactional outbox events (`invitation.print-quotation-issued`, `invitation.print-order-approved`, `invitation.print-order-ready`).

4. **HTTP & OpenAPI Specification:**
   - 15 REST endpoints mounted in `print-orders.router.ts` and registered in OpenAPI registry.
   - Deterministic artifact `openapi/openapi.json` generated and verified via `npm run api:check`.
   - Digest recorded in `openapi/openapi.sha256`: `317675b0bdd23243371111490a3c90b80bf33b4a238a743a05647c6b8dde4323`.

5. **Quality Gates & Automated Verification:**
   - `npm run typecheck`: 0 errors.
   - `npm run lint`: 0 errors, 0 warnings (`--max-warnings 0`).
   - `npm run test:unit`: 61 test files, 778 tests passed.
   - `tests/integration/invitation-studio/print-order-native.test.ts`: 7 native PostgreSQL integration tests passed.
   - `tests/integration/invitation-studio/studio-waves.test.ts`: 42 native PostgreSQL integration tests passed.
   - `npm run api:check`: Byte-identical contract check passed.

## 20.18 SPEC-05 Waves 1–7 Audit Defect Resolution — 2026-10-09

Comprehensive defect resolution across `wedding-be`, `wedding-web`, `wedding-manage-web`, and `wedding-app` for SPEC-05:

1. **Backend Core & Domain Hardening:**
   - Idempotency command digest bound to `(bookingId, actorId, action, resourceId, payload)` preventing cross-action replay.
   - Replacement proposal lifecycle exposed via `PrintOrderView.pendingReplacementProposal` with 7-day expiry and revision tracking.
   - Mandatory non-empty reason on cancellations of `APPROVED` print orders with verified Couple intent.
   - Correct billing calculation separating credit adjustments from cash refunds: `acceptedChargesVnd` = net charges, `refundedVnd` = cash refunds only.
   - Strict credit replay validation on `(bookingId, receivableChargeId, amountVnd, reason)` preventing duplicate credits.
   - Monotonic sequence, tie-breaker cursor pagination, and real `approvedAt` audit resolution in `InvitationReportingReader`.
   - Explicit `SYSTEM` authority purpose enforcement for automation (`automation:media-cutoff`) and reporting (`reporting:invitation-studio`).
   - Exclusion of dummy zero-UUIDs and non-eligible bookings in `InvitationAutomationReader`.

2. **Client Implementations & UI Alignment:**
   - Integration with real sessions (`WebIdentitySession`, `ManagementIdentitySession`, `AndroidIdentitySession`) and real bookings.
   - File upload connection to `gateway.uploadMedia` across clients.
   - Manager template CRUD and publication/archival operations.
   - Consumption of server-generated `publicSlug` and publication revision.
   - AI generation DTO corrected to `mediaAssetId` and prompt limit configured to 2,000 characters.
   - Preserved `Idempotency-Key` across retries.
   - Removed obsolete `handedOverAt` from handover requests.
   - Design system styling applied to public invitations (Forest/Sage/Ivory/Champagne).
   - Clear distinction between `APPROVED` and `IN_PRODUCTION`.

3. **Contract Lock & Verification:**
   - Client lockfiles retain baseline commit `168f61dd16fa58760b0d6238b7ebfd73503471c7` with pending working-tree extensions.
   - Deterministic OpenAPI check passes byte-for-byte.
   - 100% test pass and 0 lint warnings across all 4 repositories.
   - Traceability matrix and evidence documented in `tasks/evidence/invitation-studio.md`.

