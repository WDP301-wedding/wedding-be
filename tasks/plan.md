# Implementation Plan: Wedding Management System

Current status: 2026-10-09 (Asia/Saigon). Active baseline:
[WEDDING-CONTRACT-1@1.1.0](../CONTRACT-BASELINE.md).

Core platform, identity access, venue catalog, and booking lifecycle are accepted.
SPEC-03 reached BK-C4 on 2026-10-08. The post-SPEC-03 experience and password email OTP
are delivered; device review, target deployment, owner visual acceptance, and final
release checks remain open. SPEC-04–11 specifications are approved; their bounded
implementation plans and acceptance remain pending.

Use [todo.md](./todo.md) for remaining work, [team implementation](../docs/team-implementation.md)
for provider hand-offs, and [CAPABILITY-MAP.md](../CAPABILITY-MAP.md) for ownership and
dependency direction. Requirements remain in [PRODUCT-REQUIREMENTS.md](../PRODUCT-REQUIREMENTS.md).

The [archived implementation plan](../docs/archive/2026-10-09/plan.md) preserves
completed CP/IA/VC/BK slices, original approvals, risks, and checkpoint history.
Section numbers 17–21 below are retained for existing specification/ADR references.

## Current implementation sequence

1. Prepare the SPEC-04 payments/billing bounded plan against the accepted Booking providers.
2. Integrate SPEC-05 invitations/media/print after the billing and access boundaries are ready.
3. Integrate SPEC-06 households, guest groups, personalized invitations, and RSVP.
4. Proceed through SPEC-07 seating and SPEC-08 staff; SPEC-09 notifications can use
   available producer events as defined by the baseline.
5. Complete SPEC-10 analytics after real source providers are ready; SPEC-11 release
   waits for all preceding implementations and acceptance evidence.

Independent slices may overlap only under the hand-off rules below. Shared Prisma
migrations and OpenAPI publication stay in one serialized backend lane.

## 17. Venue-Catalog implementation constants

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

## 20. SPEC-03 `booking-lifecycle` bounded implementation plan

Status: **Accepted at BK-C4 on 2026-10-08; BK-W1–BK-W8 complete.**

The [accepted checkpoint](./evidence/booking-lifecycle.md#bk-c4-implementation-acceptance--2026-10-08)
closes ACC-001 and TML-001–008. Booking providers are available for controlled
downstream integration; this does not implement SPEC-04 payments or authorize deployment.

The [original approved plan and wave/checkpoint details](../docs/archive/2026-10-09/plan.md#20-spec-03-booking-lifecycle-bounded-implementation-plan)
remain archived with their approval and risk records.

## 21. Approved product completion sequence (2026-10-08)

The project owner approved the product additions discussed in this chat and explicitly
kept the entire notification center in SPEC-09. This records scope and sequencing;
detailed additive contracts and bounded tasks are prepared at the corresponding milestone.
Existing SPEC numbers, module ownership, baseline 1.1.0, and accepted CP/IA/VC history
remain the coordination references. Current SPEC-03 acceptance closes its approved scope
before the post-SPEC-03 additions begin.

### 21.1 After SPEC-03 implementation acceptance

| Addition | Scope and owning module | Completion evidence |
| --- | --- | --- |
| Public Website | `wedding-web` landing page, hall list/detail, menus/prices, and contact/consultation entry points; consume SPEC-02 public catalog APIs. | Responsive public journey, published catalog data, loading/empty/error states, and working consultation entry. |
| Consultation intake | `booking-lifecycle` owns public request submission and Manager review/conversion into a consultation; identity retains workspace invitation ownership. | Guest request -> Manager review -> consultation -> existing restricted invitation/workspace, with duplicate-submission and authorization proof. |
| Couple overview | Web navigation and restricted proposal/timeline overview; full Couple Web/App navigation, event details, preparation progress, and required actions use backend capabilities. | Restricted access stays bounded; Web/App views use real approved APIs and backend-owned state. |
| Account settings | `identity-access` owns profile edits and authenticated password change; complete the existing SPEC-01 forgot/reset-password experience. | Own-account updates, safe profile fields, credential verification/session policy, and existing reset flow tested across the applicable clients. |

Prepare an additive specification and bounded plan for these additions before product
implementation. Intake fields/lifecycle, permitted profile fields, password-change
session behavior, route ownership, and the screen/API/acceptance matrix must be explicit;
do not infer a public registration or automatic booking flow from a consultation request.
Keep account security contracts with identity and consultation state with booking.

The overview is extended incrementally with real provider readiness: payment/billing
after SPEC-04, invitation/media/print after SPEC-05, RSVP after SPEC-06, and seating
after SPEC-07. Upcoming features are not presented as completed workflows. Android
remains available only after FULL access and confirmed deposit. Notification lists,
unread badges, read actions, email/push expansion, and notification navigation wait
for SPEC-09; they are not an early post-SPEC-03 slice. Existing identity credential
email delivery continues through its accepted provider boundary.

### 21.2 After SPEC-05 implementation acceptance

`invitation-studio` owns the print-file output follow-up: approved revision preview,
file generation, authorized download, and delivery to the restaurant for printing.
Specify format, physical dimensions, front/back arrangement, font handling, image
quality, QR readability, and revision identity in its bounded plan before implementation.
Generated output must resolve the exact accepted immutable printable snapshot rather
than current mutable invitation content. It preserves the no-recipient-name and generic
QR rules and keeps private originals behind authorized access.

Complete file output without seating first. Output containing seating reaches real
integration acceptance only after SPEC-07 provides accepted seating snapshots; the
SPEC-05 registry contract/fakes alone cannot close that integration.

### 21.3 At SPEC-09

Deliver the notification center together with SPEC-09 notification settings, email,
Android push, and scheduled reminders. User-facing inbox entries, unread/read state,
and authorized links to relevant screens are distinct from Manager delivery-attempt
status. Specify their account/booking scope, safe content, lifecycle, APIs, and client
acceptance in the SPEC-09 bounded plan. Opening or reading a notification never approves
a timeline, settles a payment, or grants resource access.

### 21.4 Acceptance and allocation

The follow-up plans name repository/module owners and map each screen to provider APIs
and focused acceptance scenarios. Final cross-module and release evidence includes the
public-to-consultation journey, progressive Couple overview, account settings/reset,
exact-revision print output, and SPEC-09 inbox. New additions remain pending until
their actual implementation and evidence are accepted; this scheduling decision does
not mark any existing or new implementation complete.

### 21.5 Post-SPEC-03 implementation record

The owner's 2026-10-08 request authorizes implementation after completed SPEC-03.
The additive [experience SPEC](../SPEC-post-booking-experience.md) defines four bounded
waves: backend/persistence/security; OpenAPI/public discovery/Manager intake; Couple
overview/account settings; verification and evidence. Codex is the sequential
implementation owner across all four repositories, keeping migration/OpenAPI writes
in one lane. The current implementation and quality checks are recorded in
[post-SPEC-03 evidence](./evidence/post-spec03-experience.md). Physical Android review,
shared database deployment, and project-owner visual acceptance remain explicit
runtime/release checks. This does not advance SPEC-04–SPEC-11 or their deferred features.
