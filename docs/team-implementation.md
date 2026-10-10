# Team Implementation Contract: SPEC-03 through SPEC-11

> Current team scope confirmed 2026-10-10: [backend amendment](./backend-scope-2026-10-10.md). SPEC-06 onward and commercial/profile extensions are backend-only. Earlier client requirements/three-person allocation describe historical work; the frontend team owns future UI. [Active tasks](../tasks/backend-revision-todo.md) govern execution.

Status: **Approved contract and team allocation** by the project owner, 2026-10-06.
Active baseline: `WEDDING-CONTRACT-1@1.1.0`.
Inherited baseline: `WEDDING-CONTRACT-1@1.0.0`.
Accepted additions: [amendment 1.1.0, Section 21](../CONTRACT-BASELINE.md).
Module register: [CAPABILITY-MAP.md](../CAPABILITY-MAP.md).

## 1. What independent implementation means

Different members may implement different SPECs, or non-overlapping slices of them,
at the same time. Each slice has an agreed interface and uses a provider implementation
or a contract-conforming fake. The team does not need to finish every upstream screen
before starting a downstream domain service or adapter. It does need the relevant
provider contract approved before relying on its meaning.

Independent implementation does not mean all modules, all files, migrations, integrations,
or acceptance gates can run simultaneously. The table in each SPEC is the operative
permission/dependency map. The nine SPECs are approved; coding starts only after the
relevant bounded implementation plan also receives its normal approval. This document
does not issue deployment or release approval.

## 2. Readiness labels and hand-off package

| Label             | Meaning                                                                                                    | Required evidence                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CONTRACT_READY    | Owner/provider-consumer signatures, DTOs, failures, states, defaults, fixtures, and authorization reviewed | Approved SPEC + contract SHA; module plan approved before coding.                               |
| ISOLATED_READY    | Slice passes its own focused tests with conforming provider doubles                                        | Passed fake conformance suite; feature remains unwired/disabled.                                |
| PROVIDER_READY    | Relevant real provider methods, migration, boundary checks, and contract tests work                        | Exact provider commit and PostgreSQL evidence; this may precede all provider client screens.    |
| INTEGRATION_READY | Consumer tests run against those real provider methods                                                     | Duplicate/stale/denial/failure/race tests and committed generated API digest.                   |
| ACCEPTED          | Complete module passes owner-reviewed acceptance                                                           | Backend requirement matrix, migrations, quality gates, real integrations and frontend hand-off. |

### Application Providers Versus External Services

In historical checkpoints, a "real provider" may mean an actual Booking, Identity,
Venue or Billing application implementation using disposable PostgreSQL, while its
external network transport is controlled. This is not proof of a live VNPay, Gemini,
Storage or email operation. Owner acceptance of that baseline is retained, but does
not silently close live-service or deployment gates.

Record code/test evidence, configuration, live external-provider evidence and target
environment separately. A health response, bucket/sender read, credential presence,
export/build or adapter test alone cannot close an end-to-end feature gate. Use the
[SPEC-01–05 audit](../tasks/evidence/spec01-05-runtime-audit-2026-10-10.md) and
[RV backlog](../tasks/backend-revision-todo.md#spec-01-05-runtime-and-provider-follow-ups).
Missing evidence stays pending; intentionally disabled optional features are labelled
disabled, not live-verified. Required disabled features still block their full journey.

At contract hand-off, publish:

- the provider application file path and exact version/commit;
- strict DTO schemas with required/nullable fields, units, bounds, ordering, and errors;
- example success/denial/not-found/stale/duplicate/unknown/unavailable results;
- an executable conformance suite run against both the fake and real adapter;
- an owner/reviewer by role, migration reservation, and integration-test owner;
- external API schema/digest only when runtime routes and backend tests are implemented.

Contract declarations should be small owner-owned files separate from service/repository
implementations. A contract PR may merge before the provider's full implementation.
Backend consumers import application contracts only. Client consumers use generated
OpenAPI types. Components may be developed offline with local presentation fixtures
early; network adapters and final client integration wait for the implemented committed
OpenAPI digest. TypeScript declarations in these Markdown files are not a substitute digest.

## 3. Parallel-work matrix

The matrix retains the original allocation. For the confirmed backend revision,
use the active backlog directly without a separate per-task decision/plan approval;
real provider integration still requires CONTRACT_READY.

| SPEC             | Work that can overlap an unfinished provider                                                            | Needs real provider before integration                                          | Acceptance order                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 03 Booking       | Pure slot/timeline/policy rules, persistence port tests, timeline UI fixtures                           | Identity + venue; SPEC-02 V4 remains the implementation start gate              | Booking provider before deposit integration.                   |
| 04 Payments      | Payment/refund domain, callback parser, VNPay adapter doubles, ledger repositories after migration lane | Booking deposit reservation/recording + identity promotion                      | Deposit money/access/slot evidence before acceptance.          |
| 05 Invitation    | Media validation, design/editor, print arithmetic, registry implementation                              | Confirmed booking/timeline + billing charge/credit                              | Print approval after actual billing/timeline boundary.         |
| 06 Guest         | Groups, optional named Guests/import, explicit independent planning and optional read-only links        | Booking ordered headcount; publication only for personalized links              | Real no-list/partial-list/planning proof; optional link proof. |
| 07 Seating       | Compatibility/remapping/label rules, plan repositories, UI fixtures                                     | Venue + booking + guest + invitation registry                                   | Confirm/invalidate/print races before Staff integration.       |
| 08 Staff         | Assignments, explicit opt-in mode, one-person check-in/undo journal                                     | Identity + booking + Guest search; Seating guidance optional                    | Mode-aware reporting and real concurrent check-in proof.       |
| 09 Notifications | Intent/retry/scheduler/channel doubles, each handler with a frozen producer schema                      | Identity port + each producer/recipient/due-command port                        | May run alongside 07/08/10; complete after required producers. |
| 10 Analytics     | Metric functions/fixtures and individual source projectors as sources become ready                      | Owner reporting pages; all guest/staff/billing/print sources for full dashboard | Does not wait for notification delivery.                       |
| 11 Release       | Deployment validation code, seed orchestration interfaces, evidence/checklist scaffolding               | All accepted implementations and actual deployed environments                   | Release journey/seed/migration/go-live remains last.           |

Original integration spine (the current amendment below overrides Guest prerequisites):

```text
venue V4 -> booking providers -> payment deposit -> invitation print/publication -> guest
                                                                              |     |
                                                                         seating   notifications
                                                                            |
                                                                           staff
                                                                            |
                                                                         analytics
                                                                            |       |
                                                                            +--- release
```

Current Group/list/planning work requires Booking access and ordered headcount,
not invitation publication. Publication gates only optional personalized links.
Seating works without Guest names; check-in is separately opt-in and missing Seating
guidance is not a Staff write blocker. Disabled check-in reports not recorded,
not zero wedding attendance. SPEC-06 onward execution is backend-only; UI fixtures
and client integration in this historical allocation belong to the frontend team.

This is integration readiness, not a blanket ban on overlapping isolated coding.
Payments adapter can be built while Booking Web screens are still being finished.
Seating and Notifications have distinct owners and can implement simultaneously.
Prisma migration publication and print/settlement boundary changes remain coordinated.

## 4. File lanes and shared resources

Each module owner exclusively edits `src/modules/<module-id>/`, its module-specific
tests and its own SPEC. Client feature directories are owned by the frontend team. Small slices keep the
existing five-human-authored-file limit; generated artifacts are tracked separately.

One integration steward owns `src/app.ts`/composition root, OpenAPI registration,
shared core outbox/unit-of-work support, seeds, `prisma/schema.prisma`, migrations,
package scripts, and API artifact publication. Owners submit schema fragments and
wiring requests; the steward serializes/rebases them. Two feature branches may author
separate schema proposals, but committed migration order is one lane. Each migration
is verified from the latest accepted schema and from empty PostgreSQL before hand-off.
Applied migrations are immutable.

Use separate `codex/<module>-<slice>` branches/checkouts when multiple people edit the
same repository. Do not edit a colleague's provider contract to unblock a consumer.
Contract changes name affected providers/consumers, amend the active baseline first,
and include fake/real conformance proof. Identity additions and core unit-of-work/outbox
adapters are separately owned prerequisite slices; their existence is not assumed from
a Markdown declaration.

## 5. Error and mock rules

All external APIs inherit core envelope/status semantics. Use 400/422 for invalid
input, 401 for unauthenticated, 403 for visible forbidden operations, concealed 404 for
unowned private resources, 409 for current-state/revision conflicts, and 503 for an
unavailable mandatory provider. State-changing POSTs use a durable idempotency key.
Canonical payload hashes include the route/resource and stable submitted data; request ID
and processing timestamp are not part of intent identity. Retain business intent keys
for the record's lifetime; external provider retention does not shorten internal dedup.

Fakes must model authorization, empty results, nulls, stale/conflict handling, duplicate
replay, dependency failure, and unknown effects. They must not return success for every
input or generate authoritative totals independently. Same-key/different-body is 422;
in-flight duplicate is 409. The conformance suite is owned by the provider, and its
real-provider run is required at PROVIDER_READY. Unknown outcomes remain pending
reconciliation; retries preserve intent identity.

Cross-owner atomic operations use an application unit-of-work boundary supplied by core
and implemented by owner adapters. It keeps trusted context and serialization/locks
inside application infrastructure. There are no Prisma transaction/repository imports
in consumer domain code. Lock order is booking, domain aggregate, billing source,
print registry; all paths use this order, with venue eligibility lifecycle locks after
booking and before the domain aggregate when required. Venue retirement holds only
its owner lifecycle lock and emits downstream invalidation after commit. Contract tests
prove rollback and race behavior. Real guest-plan activation and booking headcount
synchronization are one transaction; staged recovery is not completed integration.

## 6. Bounded implementation waves and quality gates

Each SPEC includes proposed vertical outcomes and acceptance microchecks. Those are
inputs to the module plan; they become executable tasks only after its approval. Preserve
existing CP/IA/VC tasks and checkpoints. Green focused waves continue within the existing
fast-track protocol.

Focused changes run targeted tests, changed-file formatting, and diff checks. At the
module API/provider checkpoint, run the backend scripts from `package.json`:

```powershell
npm run lint
npm run typecheck
npm run test:coverage
npm run test:integration -- --maxWorkers=1
npm run test:contract
npm run api:generate
npm run api:check
npm run build
npm run audit:ci
```

Final acceptance adds empty/upgrade migrations, seed rerun proof, critical cross-module
journey and privacy/redaction gates from
[cross-repository development](cross-repo-development.md). Skipped PostgreSQL tests or
fake-only money/access/snapshot paths are explicitly incomplete, never accepted.

## 7. Defaults and decisions

Numeric policies in the approved SPECs are fixed implementation defaults for the demo
scope, locked by project-owner approval on 2026-10-06. Owners must not invent different
values. Policies become versioned snapshots on affected records and
cannot change through an environment variable. Production secrets, deployment URLs,
email domains, VNPay credentials, and EAS identity are resolved at release provisioning
without altering domain contracts.

The owner approved the amendment and SPEC-03 through SPEC-11 together on 2026-10-06
with “vậy tôi duyệt draft trên”. Baseline 1.1.0 is active, while the 1.0.0 and CP/IA/VC
approval records remain historical evidence. This does not approve unprepared module
plans or mark implementation complete. Isolated implementation can overlap after its
own plan and contract-artifact gates; real integration and acceptance follow provider readiness.

## 8. Approved initial three-person allocation

| Owner role | SPEC ownership                         | Initial work after the relevant plan is approved                                                                                                                  |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A          | SPEC-03 Booking, then SPEC-04 Payments | Implement Booking providers; payment domain/adapter slices may overlap, but deposit integration waits for the real Booking ports.                                 |
| B          | SPEC-05 Invitation, then SPEC-06 Guest | Implement editor/media/print rules with conforming doubles first; real publication/print needs A's providers, and Guest needs publication plus ordered headcount. |
| C          | SPEC-07 Seating, then SPEC-08 Staff    | Implement capacity/remap/attendance rules, persistence and UI fixtures; confirmation/search/guidance integration waits for A/B and the relevant real owner ports. |

These are role labels, not named individuals or newly created chats. Each SPEC has one
primary owner. The three members can prepare their plans concurrently; they do not need
to wait for an upstream owner's entire pair of SPECs or every client screen to finish.
They do need the specific provider methods and real conformance evidence before wiring.

Before concurrent shared-file work, select one of A/B/C as integration steward; no
person is chosen by this approval record. That member serializes migrations, core/
identity/venue prerequisite adapters, wiring and OpenAPI publication. Provider owners
retain their module implementations and submit bounded shared changes to the steward.
Coordinate Booking–Payment, Guest–Headcount and Seating–Print–Billing boundary tests.

SPEC-09 through SPEC-11 are approved specifications but remain unassigned for the next
allocation round. Approval alone does not satisfy CONTRACT_READY's published artifact/
conformance package, PROVIDER_READY, INTEGRATION_READY or ACCEPTED. Module plans,
implementation and real-provider evidence remain pending.

## Backend Acceptance From SPEC-06

Do not assign frontend source changes, browser/typography checks, client generation,
Android builds or new frontend design-system work to backend module waves. Preserve
sibling repositories. Backend hand-off includes exact schemas/OpenAPI digest, fixtures,
errors, authorization, migrations, money invariants and real provider evidence.
PROVIDER_READY/INTEGRATION_READY retain their actual implementation requirements;
backend ACCEPTED requires complete backend evidence, independent of frontend screens.
Full product release additionally records frontend integration by the frontend team.
Historical A/B/C assignments are not assignments to the newly separate frontend team.
The owner has already confirmed the business scope; do not re-ask permission for
routine backend preparation within these requirements.
