# Capability Map: Wedding Management System

> Current scope (confirmed 2026-10-10): [backend amendment](./docs/backend-scope-2026-10-10.md) and [active tasks](./tasks/backend-revision-todo.md). SPEC-06 onward has backend acceptance only; client implementation and visual/native checks belong to the frontend team. Earlier conflicting outlines are superseded.


- Approved cross-module requirements: [`PRODUCT-REQUIREMENTS.md`](./PRODUCT-REQUIREMENTS.md)
- Decision rationale: [`ADR-001`](./docs/decisions/0001-model-revised-wedding-operations-with-existing-capabilities.md)
- Locked contract baseline:
  [`WEDDING-CONTRACT-2@2.0.0`](./CONTRACT-BASELINE.md) (current specification; 1.x history and implemented compatibility retained)
- Parallel-specification decision:
  [`ADR-002`](./docs/decisions/0002-freeze-program-contracts-before-parallel-specification.md)
- Accepted implementation hand-off decision:
  [`ADR-003`](./docs/decisions/0003-publish-provider-hand-offs-for-overlapping-implementation.md)

## Initiative

Build a serious, demo-ready wedding management system for one restaurant within a 10-week academic delivery window. The system spans four repositories:

- `wedding-be`: Express REST API and shared business rules.
- `wedding-web`: Next.js public website, read-only Guest invitation, and Couple Web experiences.
- `wedding-manage-web`: Next.js Manager and Staff administration experiences.
- `wedding-app`: Expo Android application for Couple workflows.

Business rules are authoritative in the Express API. Web and App clients consume API contracts and must not independently decide booking, payment, authorization, refund, or check-in rules.

## Modules

| Module ID | Responsibility | Depends on |
|---|---|---|
| `core-platform` | TypeScript conventions, Express foundation, Prisma/PostgreSQL, migrations, API/error conventions, audit logging, idempotency, Supabase Storage, Resend, and the `AiImageProvider` boundary | — |
| `identity-access` | Pre-deposit workspace invitations, limited prospect access, post-deposit Couple access promotion, login, access/refresh tokens, refresh rotation, password reset, RBAC, and session management | `core-platform` |
| `venue-catalog` | Restaurant settings, `LUNCH`/`DINNER` shifts, halls, dishes, menu packages, add-on service/print offerings and pricing, media, reusable wedding-timeline templates, and fixed seating-layout templates with supported capacity ranges | `core-platform`, `identity-access` |
| `booking-lifecycle` | Separate bride/groom profiles, commercial contracts/appendices, consultation records, restricted pre-deposit workspaces, availability, temporary slot holds, online/counter bookings, versioned timeline proposals and mutual approval, deposit eligibility, policy snapshots, post-deposit change requests, cancellation, audit history, and booking states | `identity-access`, `venue-catalog` |
| `payments-billing` | VNPay sandbox, manual payments, idempotent callbacks, deposit and remaining-balance accounting, agreed contract/appendix charges, incidental expenses, immutable final invoices/adjustments, and manual refunds | `booking-lifecycle` |
| `invitation-studio` | Template library, Gemini-generated assets, post-deposit wedding-media library, full Web editor, quick App edits, generic public invitation QR, printable revision snapshots, multi-variant print orders, and print fulfillment status | `core-platform`, `identity-access`, `venue-catalog` (1.1.0 eligibility), `booking-lifecycle`, `payments-billing` |
| `guest-management` | Invitation-household list/import, default and custom guest groups, personalized electronic invitation links, invitation delivery, Couple/Manager-entered expected counts and ordered guest plans | `booking-lifecycle`, `invitation-studio` |
| `seating-plan` | Capacity-compatible fixed-layout selection, guest-group colors, table-level group labeling, layout confirmation, and compatibility warnings when expected headcount changes | `venue-catalog`, `booking-lifecycle`, `guest-management`, `invitation-studio` (printable registry) |
| `staff-operations` | Staff accounts, event assignments, invitation-household search, multi-arrival manual check-in, actual companion counts, guest-group guidance, and audited attendance corrections | `identity-access`, `booking-lifecycle`, `guest-management`, `seating-plan` |
| `notifications-automation` | Android push notifications, operational email, workspace invitations, timeline approval and change events, payment and print-order events, contract/appendix/final-invoice facts, D-3 reminders, and booking completion jobs | `identity-access`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-management` |
| `analytics-dashboard` | KPIs, revenue, receivables, booking status, hall utilization, menu popularity, print-order status, and expected-versus-actual attendance by invitation household and guest group | `venue-catalog`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-management`, `seating-plan`, `staff-operations` |
| `release-demo` | End-to-end verification, demo seed data, Web/API deployment, Android EAS build, logging, and the demo checklist | All preceding modules |

Module IDs are stable. The owner explicitly approved replacing `guest-rsvp` with `guest-management` on 2026-10-10 because guests no longer respond; other IDs and SPEC numbers remain unchanged. Each module receives its own `SPEC-<module-id>.md` before planning or implementation begins for that module. Those module specs must trace applicable requirements from `PRODUCT-REQUIREMENTS.md`.

## Specification Register

Implementation hand-off: [team implementation contract](./docs/team-implementation.md).
SPEC-03 through SPEC-11 are approved against active additive 1.1.0 in baseline
Section 21, retaining inherited 1.0.0 history. After their bounded plan/artifact gates,
slices can be coded concurrently using conforming provider fakes; real integration/
acceptance remain provider-ordered. Every module/file/migration need not run simultaneously.
The accepted invitation dependency includes an upstream venue eligibility read.
Initial ownership is A: 03–04, B: 05–06, C: 07–08; 09–11 remain unassigned.

At the 2026-10-06 contract checkpoint, later-module documents below were **approved
specifications**; module plan and implementation acceptance are recorded separately.
SPEC-03 implementation is now accepted at BK-C4 on 2026-10-08. The owner approved the assembled contract
package on 2026-10-06 with “vậy tôi duyệt draft trên”. Provider meanings were reviewed
in dependency order; real-provider and module acceptance gates remain unchanged.

| Module | Specification | Contract status |
| --- | --- | --- |
| `core-platform` | [`SPEC-core-platform.md`](./SPEC-core-platform.md) | Approved |
| `identity-access` | [`SPEC-identity-access.md`](./SPEC-identity-access.md) | Approved |
| `venue-catalog` | [`SPEC-venue-catalog.md`](./SPEC-venue-catalog.md) | Approved; implementation remains subject to V4 |
| `booking-lifecycle` | [`SPEC-booking-lifecycle.md`](./SPEC-booking-lifecycle.md) | ACCEPTED implementation; BK-C4 passed 2026-10-08 |
| `payments-billing` | [`SPEC-payments-billing.md`](./SPEC-payments-billing.md) | Completed SPEC-04 per owner; commercial/final-invoice extension pending |
| `invitation-studio` | [`SPEC-invitation-studio.md`](./SPEC-invitation-studio.md) | SPEC-05 backend completed per owner; new print commercial linkage extension pending |
| `guest-management` | [`SPEC-guest-management.md`](./SPEC-guest-management.md) | Approved SPEC; plan/implementation pending |
| `seating-plan` | [`SPEC-seating-plan.md`](./SPEC-seating-plan.md) | Approved SPEC; plan/implementation pending |
| `staff-operations` | [`SPEC-staff-operations.md`](./SPEC-staff-operations.md) | Approved SPEC; plan/implementation pending |
| `notifications-automation` | [`SPEC-notifications-automation.md`](./SPEC-notifications-automation.md) | Approved SPEC; owner/plan/implementation pending |
| `analytics-dashboard` | [`SPEC-analytics-dashboard.md`](./SPEC-analytics-dashboard.md) | Approved SPEC; owner/plan/implementation pending |
| `release-demo` | [`SPEC-release-demo.md`](./SPEC-release-demo.md) | Approved SPEC; owner/plan/implementation pending |

W1 progress is tracked in [SPEC-05 Section11](./SPEC-invitation-studio.md#11-w1-backend-implementation-checkpoint--2026-10-09)
and [todo B-EXEC](./tasks/todo.md#b-exec--execution-waves-and-verified-implementation-status).
The subsequent [SPEC-05 Section12](./SPEC-invitation-studio.md#12-media-http-server-checkpoint--2026-10-09)
records five media HTTP operations mounted in the server and documented in OpenAPI.
The subsequent [SPEC-05 Section13](./SPEC-invitation-studio.md#13-w2w4-backend-implementation-checkpoint--2026-10-09)
records verified template/design/AI, publication/public/generic QR and printable
registry/proof/owner-lock implementation; detailed closure is at plan20.15.
Other W6 APIs, complete Booking/Payments implementation, reviewed committed API/client
pins, whole-module acceptance and release retain their own gates.

## Dependency Direction

```text
core-platform
    |
identity-access
    |
venue-catalog
    |
booking-lifecycle
    |
payments-billing
    |
invitation-studio
    |
guest-management
    |\
    | +---------------------> notifications-automation --------+
    v                                                        |
seating-plan                                                 |
    |                                                        |
    v                                                        |
staff-operations                                             |
    |                                                        |
    v                                                        |
analytics-dashboard -----------------------------------------+
                                                             |
                                                             v
                                                        release-demo
```

The diagram shows the governing provider spine and the first approved branch in the
program. Final contract approval remains provider-first. After `guest-management` is stable,
the `seating-plan → staff-operations → analytics-dashboard` chain and
`notifications-automation` are the principal parallel branches. `release-demo` waits
for both. Dependencies must remain acyclic; cross-module communication uses
provider-owned contracts or domain events defined by the providing module.

Drafting may overlap earlier than implementation under `WEDDING-CONTRACT-1@1.0.0`,
but a draft does not satisfy its contract, plan, implementation, or integration gate.
`SPEC-02` retains its V1–V4 acceptance history. V4 was accepted on 2026-10-06;
`SPEC-03` received bounded-plan approval on 2026-10-07 and implementation acceptance
at BK-C4 on 2026-10-08; see its [acceptance evidence](./tasks/evidence/booking-lifecycle.md#bk-c4-implementation-acceptance--2026-10-08).

`guest-management` owns guest-group definitions because the same group identifies an invitation household before it labels any table. `seating-plan` consumes those stable group identifiers and the fixed layout templates owned by `venue-catalog`; this direction avoids a dependency cycle between the guest list and seating plan.

## Required Product Boundaries

- Single restaurant only; no tenant boundary is required.
- Guest uses a personalized Web link without an account.
- A prospective couple receives an expiring invitation to a restricted Web workspace after the restaurant creates a consultation record. Before deposit, that workspace exposes proposals, timelines, separate names and commercial menu/print/service selection and contract approval/PDF; editing media/invitations and print production remain post-deposit.
- Deposit is unavailable until both parties approve the exact current timeline and commercial contract; deposit is 30% of the whole agreed contract. A successful deposit promotes the existing identity and consultation data to full Couple access instead of creating a second account.
- Wedding-photo upload and access are available only after successful deposit. The shared media library supports upload, preview, replacement or deletion before the restaurant's cutoff, and restaurant download; image editing and a public album are not required.
- The full AI invitation editor is on Web; App supports preview, quick text edits, sending, and sharing.
- The restaurant owns immutable seating-layout geometry and capacity ranges. The couple may select a compatible layout and apply guest-group labels and colors to tables, but cannot move, add, or remove tables or assign an individual guest to a specific table.
- One guest-list record represents an invitation household or party, not necessarily one person. It has a representative name, optional disambiguating contact data, a guest group, an expected attendee count, and optional notes.
- Staff check in an invitation household by name, with optional phone lookup for disambiguation. Multiple arrivals may be recorded against one invitation; actual attendees accumulate, over-expected arrivals warn without blocking, and every correction remains auditable.
- A physical-invitation print order may contain multiple design variants and quantities. Restaurant quotation and couple approval precede production; each approved line captures an immutable printable revision. Contract-included print fulfillment is not charged twice; agreed commercial changes use approved appendix deltas.
- Physical invitations omit the recipient name and use one generic QR for the wedding. The QR opens a public electronic invitation but does not identify a guest, select a guest group, submit a check-in, or serve as a staff credential.
- The required mobile deliverable is an Android build through EAS; iOS is not an acceptance target.
- Core business behavior must remain production-minded despite the 10-week demo constraint: database-enforced slot safety, payment idempotency, RBAC, validation, audit trails, and safe secret handling are mandatory.

## Deferred Enhancements

The following do not receive required modules or acceptance criteria. They may be reconsidered only after all required modules pass verification:

- Guest experience in the Expo App.
- Automatic refunds through VNPay.
- Event types other than weddings.
- Multi-tenant support for multiple restaurants.
- Exact seat or table assignment for an individual guest.
- Couple editing of table geometry or restaurant layout-template capacity.
- Per-recipient physical-invitation QR codes and QR-based event check-in.
- Printed recipient names, in-system image editing, and public wedding-photo albums.

## Approved Dependency and Execution Order

This order governs provider integration and acceptance. Approved isolated implementation
and release scaffolding may overlap after their own SPEC/plan/provider-contract approvals;
each SPEC lists precise gates and [team implementation](./docs/team-implementation.md)
defines file/migration ownership.

1. `core-platform`
2. `identity-access`
3. `venue-catalog`
4. `booking-lifecycle`
5. `payments-billing`
6. `invitation-studio`
7. `guest-management`
8. Branch A starts with `seating-plan`; Branch B starts with
   `notifications-automation` and may proceed independently where producer contracts
   are already stable.
9. `staff-operations` follows `seating-plan` on Branch A.
10. `analytics-dashboard` follows `staff-operations` and may overlap the remaining
    notification work.
11. `release-demo` final journey/deployment starts only after both
    `notifications-automation` and `analytics-dashboard` satisfy their acceptance gates;
    approved isolated scaffolding may be implemented earlier after its own plan gate.

The initial capability map was approved by the project owner on 2026-09-24.

The revised responsibilities, dependency direction, and build order were approved by the project owner on 2026-09-26. The revision adds pre-deposit timeline collaboration, post-deposit wedding media, fixed-layout guest-group seating, invitation-household check-in, and physical-invitation print fulfillment while preserving the approved module IDs.

The contract-first coordination model and branched execution order for `SPEC-03`
through `SPEC-11` were approved by the project owner through
`WEDDING-CONTRACT-1@1.0.0` on 2026-10-06. This approval does not reopen or replan
`SPEC-02`.

The owner accepted amendment `WEDDING-CONTRACT-1@1.1.0`, ADR-003, SPEC-03 through
SPEC-11 and the three-person initial ownership split on 2026-10-06. Module task/wave
plans, published provider artifacts, implementation and acceptance remain separate gates.


## Current Backend Execution Amendment

The owner confirmed [commercial/profile requirements](./SPEC-commercial-contracts.md)
and [backend-only tasks](./tasks/backend-revision-todo.md) on 2026-10-10. Extend
Venue -> Booking -> Payments with service/print offerings, contracts, appendices and
final invoicing; preserve completed 01–04 and completed 05 backend evidence.
SPEC-06–11 acceptance is backend-only with provider/OpenAPI/frontend hand-off.
Read-only template selection is a narrow catalog port, never a dependency on
Invitation's money/access writers. Full frontend release remains a separate delivery.
