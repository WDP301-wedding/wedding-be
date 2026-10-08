# Task List: Wedding Management System

Current status: 2026-10-09 (Asia/Saigon). Active contract baseline:
[WEDDING-CONTRACT-1@1.1.0](../CONTRACT-BASELINE.md).

Core platform, identity access, venue catalog, and SPEC-03 implementation are accepted.
SPEC-04–11 specifications are approved; their bounded plans, implementation, and
acceptance remain separate gates. The unchecked module entries below retain their
combined planning/verification scope; approved SPECs do not complete those tasks.
Post-SPEC-03 experience and password email OTP are delivered, with the runtime/release
checks below still open.

| Completed scope | Evidence |
| --- | --- |
| Core platform (CP-01–32) | [Accepted 2026-10-03](../docs/archive/2026-10-09/evidence/core-platform.md) |
| Identity access (IA-01–17) | [Acceptance evidence](../docs/archive/2026-10-09/evidence/identity-access.md) |
| Venue catalog (VC-01–23 / V4) | [Acceptance evidence](../docs/archive/2026-10-09/evidence/venue-catalog.md) |
| Booking lifecycle (BK-W1–8 / BK-C4) | [Accepted 2026-10-08](./evidence/booking-lifecycle.md#bk-c4-implementation-acceptance--2026-10-08) |
| Post-SPEC-03 experience | [Delivered; runtime checks open](./evidence/post-spec03-experience.md) |
| Password email OTP | [Local demo evidence](./evidence/password-otp-local-demo.md) |

Plan: [plan.md](./plan.md). Requirements: [PRODUCT-REQUIREMENTS.md](../PRODUCT-REQUIREMENTS.md).
Ownership/dependencies: [CAPABILITY-MAP.md](../CAPABILITY-MAP.md).
Completed checklists and earlier status records: [archived task list](../docs/archive/2026-10-09/todo.md).

## Working Rules

- Complete tasks in dependency order; tasks explicitly marked parallel may use separate repository branches/sessions.
- A task is complete only when every acceptance and verification checkbox is satisfied.
- Keep human-authored scope to approximately five files. Framework-generated scaffold files are the only documented exception and must be reviewed as a single generated change.
- Update the approved spec before changing a locked architecture decision.
- Do not use live Supabase, Resend, Gemini, or EAS credentials in automated tests.
- Commit each verified task or tightly coupled task pair as an atomic save point in its owning repository.
- Preserve completed checkboxes and evidence in the archive; extending the plan must not reopen completed work without a documented reason.
- Do not implement a post-core module until its `SPEC-<module-id>.md`, detailed vertical tasks, and human approval gate exist.
- Every post-core module spec and task slice must trace its owned identifiers from `PRODUCT-REQUIREMENTS.md`.
- Every SPEC from `SPEC-03` onward must declare
  `contractBaseline: WEDDING-CONTRACT-1@1.1.0`, list its produced and consumed
  contracts/events, and use the baseline change procedure instead of silently forking
  a provider contract.
- SPEC drafts may overlap where the baseline permits. Final contract approvals,
  implementation, real-provider integration, Prisma migrations, and acceptance still
  follow their recorded dependency gates.

## Remaining team hand-offs

- [ ] Prepare bounded module task/wave plans and obtain their normal approvals.
- [ ] Assign named A/B/C members and one integration steward before shared-file work.
- [ ] Publish provider contract artifacts/conformance packages before consumer wiring;
      prove real-provider readiness and integration before module acceptance.
- [ ] Assign SPEC-09/10/11 in the next ownership round.

## Remaining module planning and verification

### SPEC-04: Specify `payments-billing`

**Description:** Specify deposit, manual/VNPay payment, balance, invoice, refund, and accepted print-charge accounting with idempotent money transitions.

**Acceptance criteria:**

- [ ] `SPEC-payments-billing.md` covers the existing payment scope and PRN-006.
- [ ] Deposit eligibility recheck, print-charge registration, receivable inclusion, idempotency, reconciliation, and refund boundaries are explicit.
- [ ] A compact plan of at most eight continuous implementation waves covers database
      constraints, provider callbacks, audit evidence, API contracts, and billing views.

**Verification:**

- [ ] Trace PRN-006 and all payment state transitions to automated tests, including concurrency and callback replay.
- [ ] Confirm `invitation-studio` can register an accepted charge without owning billing state.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Drafting may overlap SPEC-03. Final approval requires the approved
SPEC-03 provider contract; real payment integration requires the implemented booking
provider.

**Files likely touched:** `wedding-be/SPEC-payments-billing.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-05: Specify `invitation-studio`

**Description:** Specify invitation designs, private wedding media, the generic public QR, immutable printable revisions, quotation approval, and print fulfillment before adding vertical slices.

**Acceptance criteria:**

- [ ] `SPEC-invitation-studio.md` covers MED-001 through MED-006, PRN-001 through PRN-005, PRN-007 through PRN-009, and QRC-001 through QRC-004.
- [ ] Media authorization/retention, printable/commercial snapshotting, print state transitions, billing calls, and public/private asset separation are explicit.
- [ ] A compact plan of at most eight continuous implementation waves covers backend,
      Public Web, Couple App, Management Web, storage, security, contract, and race proof.

**Verification:**

- [ ] Trace every owned MED, PRN, and QRC requirement to acceptance criteria and automated tests.
- [ ] Prove the generic QR cannot reveal private media, personalized guest data, RSVP identity, or a check-in mutation.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Drafting may overlap earlier work. Final approval requires the
approved SPEC-04 billing contract; print acceptance requires the real charge registrar
and settlement reader.

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
- [ ] A compact plan of four to six continuous implementation waves covers backend and
      Guest/Couple Web import, normalization, authorization, delivery, and RSVP proof.

**Verification:**

- [ ] Trace GST-001 through GST-008 and QRC-005 to acceptance criteria and tests.
- [ ] Confirm guest-group identifiers are stable provider-owned contracts for seating, staff operations, and analytics.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Drafting may overlap earlier work. Final approval requires the
approved SPEC-05 publication contract; personalized-link acceptance requires the real
invitation provider.

**Files likely touched:** `wedding-be/SPEC-guest-rsvp.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-07: Specify `seating-plan`

**Description:** Specify capacity-compatible fixed-layout selection and table-level guest-group labeling without per-guest seating or editable geometry.

**Acceptance criteria:**

- [ ] `SPEC-seating-plan.md` covers SEA-003 through SEA-008.
- [ ] Layout selection, label mapping, headcount invalidation, Manager exception, remapping, confirmation, and audit transitions are explicit.
- [ ] A compact plan of four to six continuous implementation waves covers backend and
      Couple/Manager compatibility, stale-template, authorization, and remapping proof.

**Verification:**

- [ ] Trace SEA-003 through SEA-008 to acceptance criteria and tests.
- [ ] Search the planned contracts for prohibited individual `SeatAssignment` or Couple geometry mutations.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Drafting may overlap earlier work. Final approval requires the
approved SPEC-06 guest/group contract; seating integration requires real guest and
venue providers.

**Files likely touched:** `wedding-be/SPEC-seating-plan.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-08: Specify `staff-operations`

**Description:** Specify event assignments, household lookup, multi-arrival check-in, over-expected warnings, group guidance, and audited corrections.

**Acceptance criteria:**

- [ ] `SPEC-staff-operations.md` covers CHK-001 through CHK-008 and staff assignment/authorization.
- [ ] Arrival, correction, cumulative attendance, duplicate-name handling, concurrency, and audit state are explicit.
- [ ] A compact plan of four to six continuous implementation waves covers backend and
      Staff Web concurrency, warning, correction, privacy, and authorization proof.

**Verification:**

- [ ] Trace CHK-001 through CHK-008 to acceptance criteria and tests.
- [ ] Confirm actual attendance derives from auditable arrivals/corrections and never from QR or per-seat occupancy.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Drafting may overlap seating work. Final approval requires the
approved SPEC-07 seating contract; staff integration requires real booking, guest, and
seating providers.

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
- [ ] A compact plan of four to six continuous implementation waves covers backend and
      client fake-provider, replay, scheduling, and PII-leak proof.

**Verification:**

- [ ] Trace OPS-001 and OPS-002 to acceptance criteria and tests.
- [ ] Confirm notifications consume provider events without becoming the source of booking, payment, print, or RSVP truth.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** The locked baseline authorizes channel/provider drafting. Final
approval requires all notification producer contracts through SPEC-06; individual
handlers and acceptance wait for their real producer events.

**Files likely touched:** `wedding-be/SPEC-notifications-automation.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-10: Specify `analytics-dashboard`

**Description:** Specify restaurant KPIs, receivables, booking/hall/menu reporting, print fulfillment, and grouped expected-versus-actual attendance.

**Acceptance criteria:**

- [ ] `SPEC-analytics-dashboard.md` covers OPS-003 and OPS-004 with the existing dashboard scope.
- [ ] Metric definitions, filters, time zone, source-of-truth fields, draft/accepted print treatment, privacy, and refresh behavior are explicit.
- [ ] A compact plan of four to six continuous implementation waves covers backend and
      Management Web query, aggregation, authorization, and display proof.

**Verification:**

- [ ] Trace OPS-003 and OPS-004 to acceptance criteria and tests.
- [ ] Confirm reports do not infer per-seat occupancy and exclude draft print quotations from receivables.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Metric drafting may start early. Final approval requires the
approved payment, invitation, guest, seating, and staff contracts through SPEC-08;
analytics does not wait for notification delivery and may overlap SPEC-09.

**Files likely touched:** `wedding-be/SPEC-analytics-dashboard.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

### SPEC-11: Specify `release-demo`

**Description:** Specify the production-minded demo release, seeded end-to-end journey, deployment, Android preview artifact, observability, rollback, and evidence package.

**Acceptance criteria:**

- [ ] `SPEC-release-demo.md` covers the complete approved capability map and cross-module scenarios from `PRODUCT-REQUIREMENTS.md`.
- [ ] Deployment ownership, environment configuration, seed data, migration order, rollback, monitoring, security review, and demo script are explicit.
- [ ] A compact plan of four to six continuous release waves and explicit go/no-go
      checkpoints is approved without weakening any module's Definition of Done.

**Verification:**

- [ ] Map every capability and cross-module acceptance scenario to a release check or evidence artifact.
- [ ] Review deployment and rollback dependencies across all four repositories.
- [ ] Run Prettier and `git diff --check` on the affected documentation.

**Dependencies:** Scaffolding/checklist drafting may start early. Final SPEC and
release-plan approval wait for approved SPEC-09 and SPEC-10 contracts; release
execution and acceptance wait for every preceding real implementation.

**Files likely touched:** `wedding-be/SPEC-release-demo.md`, `wedding-be/tasks/plan.md`, `wedding-be/tasks/todo.md`

**Estimated scope:** Medium

#### Checkpoint H5 — Program specification sequence complete

- [ ] All module specs, compact implementation waves, implementations, and evidence
      approvals are complete in dependency order.
- [ ] Release planning covers the restricted-workspace-to-event-check-in journey and all four repositories.
- [ ] No deferred or out-of-scope feature was silently promoted into the required release.

## Approved product completion follow-ups (2026-10-08)

Scope and order were approved by the project owner in this chat, with the entire
notification center deferred to SPEC-09. See [plan Section 21](./plan.md#21-approved-product-completion-sequence-2026-10-08).
The post-SPEC-03 implementation was authorized in this chat and is recorded below.
Later milestone follow-ups and existing acceptance history remain intact.

### After SPEC-03 implementation acceptance

Delivered: Public Website, consultation intake/conversion, Couple overview, profile
editing, password change, and reset handling. Completed checklist history is in the
[archive](../docs/archive/2026-10-09/todo.md#after-spec-03-implementation-acceptance).

- [ ] Extend the overview with real payment, invitation, guest, and seating providers
      as SPEC-04, SPEC-05, SPEC-06, and SPEC-07 become accepted.

Contract and bounded waves: [post-SPEC-03 SPEC](../SPEC-post-booking-experience.md).
Implementation/testing owner: Codex. See [implementation evidence](./evidence/post-spec03-experience.md).
Shared database deployment, physical Android review, and owner visual acceptance remain
runtime/release checks; notification and print follow-ups below remain pending.

### After SPEC-05 implementation acceptance

- [ ] Specify print-file format/dimensions/front-back/fonts/image quality, QR checks,
      revision identity, and authorized preview/download acceptance.
- [ ] Implement print-file output from exact approved snapshots without seating.
- [ ] Complete seating-inclusive output integration after SPEC-07 acceptance.

### At SPEC-09

- [ ] Specify and implement the entire notification center: scoped inbox, unread/read
      state, authorized screen links, and Web/App presentation.
- [ ] Integrate the center with SPEC-09 settings, email, Android push, and reminders;
      keep inbox/read state distinct from delivery-attempt status and business state.

### Product completion acceptance

- [ ] Record named owners, focused runtime/security proof, and cross-module evidence
      for the additions; include these journeys in final release acceptance.

## Rolling-Plan Rule

When a SPEC task is approved, insert that module's compact implementation waves
after its specification gate; plans for separate approved SPECs may be prepared
concurrently. Record microtasks as acceptance checklists inside their owning wave
rather than expanding them into separately approved execution tasks. Link each
consumer integration wave to the real provider evidence it requires. Checklist order
does not override the dependency graph, serialized Prisma migration lane, or provider
acceptance gates. Never mark a SPEC task complete merely because a draft exists;
decision approval and wave insertion are required.
