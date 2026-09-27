# Capability Map: Wedding Management System

- Approved cross-module requirements: [`PRODUCT-REQUIREMENTS.md`](./PRODUCT-REQUIREMENTS.md)
- Decision rationale: [`ADR-001`](./docs/decisions/0001-model-revised-wedding-operations-with-existing-capabilities.md)

## Initiative

Build a serious, demo-ready wedding management system for one restaurant within a 10-week academic delivery window. The system spans four repositories:

- `wedding-be`: Express REST API and shared business rules.
- `wedding-web`: Next.js public website, Guest link/RSVP, and Couple Web experiences.
- `wedding-manage-web`: Next.js Manager and Staff administration experiences.
- `wedding-app`: Expo Android application for Couple workflows.

Business rules are authoritative in the Express API. Web and App clients consume API contracts and must not independently decide booking, payment, authorization, refund, or check-in rules.

## Modules

| Module ID | Responsibility | Depends on |
|---|---|---|
| `core-platform` | TypeScript conventions, Express foundation, Prisma/PostgreSQL, migrations, API/error conventions, audit logging, idempotency, Supabase Storage, Resend, and the `AiImageProvider` boundary | — |
| `identity-access` | Pre-deposit workspace invitations, limited prospect access, post-deposit Couple access promotion, login, access/refresh tokens, refresh rotation, password reset, RBAC, and session management | `core-platform` |
| `venue-catalog` | Restaurant settings, `LUNCH`/`DINNER` shifts, halls, dishes, menu packages, pricing, media, reusable wedding-timeline templates, and fixed seating-layout templates with supported capacity ranges | `core-platform`, `identity-access` |
| `booking-lifecycle` | Consultation records, restricted pre-deposit workspaces, availability, temporary slot holds, online/counter bookings, versioned timeline proposals and mutual approval, deposit eligibility, policy snapshots, post-deposit change requests, cancellation, audit history, and booking states | `identity-access`, `venue-catalog` |
| `payments-billing` | VNPay sandbox, manual payments, idempotent callbacks, deposit and remaining-balance accounting, physical-invitation print charges, invoices, and manual refunds | `booking-lifecycle` |
| `invitation-studio` | Template library, Gemini-generated assets, post-deposit wedding-media library, full Web editor, quick App edits, generic public invitation QR, printable revision snapshots, multi-variant print orders, and print fulfillment status | `core-platform`, `identity-access`, `booking-lifecycle`, `payments-billing` |
| `guest-rsvp` | Invitation-household list/import, default and custom guest groups, personalized electronic invitation links, invitation delivery, RSVP, optional companion counts, and expected headcount | `booking-lifecycle`, `invitation-studio` |
| `seating-plan` | Capacity-compatible fixed-layout selection, guest-group colors, table-level group labeling, layout confirmation, and compatibility warnings when expected headcount changes | `venue-catalog`, `booking-lifecycle`, `guest-rsvp` |
| `staff-operations` | Staff accounts, event assignments, invitation-household search, multi-arrival manual check-in, actual companion counts, guest-group guidance, and audited attendance corrections | `identity-access`, `booking-lifecycle`, `guest-rsvp`, `seating-plan` |
| `notifications-automation` | Android push notifications, operational email, workspace invitations, timeline approval and change events, payment and print-order events, RSVP deadlines, D-3 reminders, and booking completion jobs | `identity-access`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-rsvp` |
| `analytics-dashboard` | KPIs, revenue, receivables, booking status, hall utilization, menu popularity, print-order status, and expected-versus-actual attendance by invitation household and guest group | `venue-catalog`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-rsvp`, `staff-operations` |
| `release-demo` | End-to-end verification, demo seed data, Web/API deployment, Android EAS build, logging, and the demo checklist | All preceding modules |

Module IDs are stable and must not be renamed after approval. Each module receives its own `SPEC-<module-id>.md` before planning or implementation begins for that module. Those module specs must trace applicable requirements from `PRODUCT-REQUIREMENTS.md`.

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
guest-rsvp
    |
seating-plan
    |
staff-operations
    |
notifications-automation
    |
analytics-dashboard
    |
release-demo
```

The diagram shows the governing build order. Some internal tasks may still run in parallel once their provider contracts are stable, but a dependent module cannot be approved before its providers. Dependencies must remain acyclic; cross-module communication uses provider-owned contracts or domain events defined by the providing module.

`guest-rsvp` owns guest-group definitions because the same group identifies an invitation household before it labels any table. `seating-plan` consumes those stable group identifiers and the fixed layout templates owned by `venue-catalog`; this direction avoids a dependency cycle between the guest list and seating plan.

## Required Product Boundaries

- Single restaurant only; no tenant boundary is required.
- Guest uses a personalized Web link without an account.
- A prospective couple receives an expiring invitation to a restricted Web workspace after the restaurant creates a consultation record. Before deposit, that workspace exposes only the proposal information and versioned timeline collaboration required to reach mutual approval.
- Deposit is unavailable until the restaurant and couple explicitly approve the same timeline revision. A successful deposit promotes the existing identity and consultation data to full Couple access instead of creating a second account.
- Wedding-photo upload and access are available only after successful deposit. The shared media library supports upload, preview, replacement or deletion before the restaurant's cutoff, and restaurant download; image editing and a public album are not required.
- The full AI invitation editor is on Web; App supports preview, quick text edits, sending, and sharing.
- The restaurant owns immutable seating-layout geometry and capacity ranges. The couple may select a compatible layout and apply guest-group labels and colors to tables, but cannot move, add, or remove tables or assign an individual guest to a specific table.
- One guest-list record represents an invitation household or party, not necessarily one person. It has a representative name, optional disambiguating contact data, a guest group, an expected attendee count, and optional notes.
- Staff check in an invitation household by name, with optional phone lookup for disambiguation. Multiple arrivals may be recorded against one invitation; actual attendees accumulate, over-expected arrivals warn without blocking, and every correction remains auditable.
- A physical-invitation print order may contain multiple design variants and quantities. Restaurant quotation and couple approval precede production; each approved line captures an immutable printable revision and contributes its accepted charge to booking receivables.
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

## Approved Build Order

1. `core-platform`
2. `identity-access`
3. `venue-catalog`
4. `booking-lifecycle`
5. `payments-billing`
6. `invitation-studio`
7. `guest-rsvp`
8. `seating-plan`
9. `staff-operations`
10. `notifications-automation`
11. `analytics-dashboard`
12. `release-demo`

The initial capability map was approved by the project owner on 2026-09-24.

The revised responsibilities, dependency direction, and build order were approved by the project owner on 2026-09-26. The revision adds pre-deposit timeline collaboration, post-deposit wedding media, fixed-layout guest-group seating, invitation-household check-in, and physical-invitation print fulfillment while preserving the approved module IDs.
