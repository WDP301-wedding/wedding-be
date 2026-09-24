# Capability Map: Wedding Management System

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
| `identity-access` | Account activation, login, access/refresh tokens, refresh rotation, password reset, RBAC, and session management | `core-platform` |
| `venue-catalog` | Restaurant settings, `LUNCH`/`DINNER` shifts, halls, dishes, menu packages, pricing, and media | `core-platform`, `identity-access` |
| `booking-lifecycle` | Availability, temporary slot holds, online/counter bookings, policy snapshots, changes, cancellation, audit history, and booking states | `identity-access`, `venue-catalog` |
| `payments-billing` | VNPay sandbox, manual payments, idempotent callbacks, remaining balance, invoices, and manual refunds | `booking-lifecycle` |
| `invitation-studio` | Template library, Gemini-generated assets, full Web editor, quick App edits, preview, and persisted invitation designs | `core-platform`, `identity-access`, `booking-lifecycle` |
| `guest-rsvp` | Guest list/import, invitation tokens, invitation delivery, RSVP, companion groups, QR credentials, and expected headcount | `booking-lifecycle`, `invitation-studio` |
| `seating-plan` | Tables, Expo drag-and-drop assignment, capacity validation, and unassigned-guest tracking | `booking-lifecycle`, `guest-rsvp` |
| `staff-operations` | Staff accounts, event assignments, QR/manual check-in, actual attendance, and audited corrections | `identity-access`, `booking-lifecycle`, `guest-rsvp`, `seating-plan` |
| `notifications-automation` | Android push notifications, operational email, hold expiry, RSVP deadlines, D-3 reminders, and booking completion jobs | `identity-access`, `booking-lifecycle`, `payments-billing`, `guest-rsvp` |
| `analytics-dashboard` | KPIs, revenue, receivables, booking status, hall utilization, menu popularity, and RSVP-versus-check-in analysis | `venue-catalog`, `booking-lifecycle`, `payments-billing`, `guest-rsvp`, `staff-operations` |
| `release-demo` | End-to-end verification, demo seed data, Web/API deployment, Android EAS build, logging, and the demo checklist | All preceding modules |

Module IDs are stable and must not be renamed after approval. Each module receives its own `SPEC-<module-id>.md` before planning or implementation begins for that module.

## Dependency Direction

```text
core-platform
    |
identity-access
    |
venue-catalog
    |
booking-lifecycle
    |-------------------|
payments-billing   invitation-studio
    |                   |
    |               guest-rsvp
    |                   |
    |               seating-plan
    |                   |
    |             staff-operations
    |                   |
    |------ notifications-automation
                        |
              analytics-dashboard
                        |
                   release-demo
```

`payments-billing` and `invitation-studio` may be developed in parallel after the `booking-lifecycle` contract is stable. Dependencies must remain acyclic; cross-module communication uses provider-owned contracts or domain events defined by the providing module.

## Required Product Boundaries

- Single restaurant only; no tenant boundary is required.
- Guest uses a personalized Web link without an account.
- Couple receives an account activation link only after a successful deposit.
- The full AI invitation editor is on Web; App supports preview, quick text edits, sending, and sharing.
- Drag-and-drop seating exists only in the Expo App.
- The required mobile deliverable is an Android build through EAS; iOS is not an acceptance target.
- Core business behavior must remain production-minded despite the 10-week demo constraint: database-enforced slot safety, payment idempotency, RBAC, validation, audit trails, and safe secret handling are mandatory.

## Deferred Enhancements

The following do not receive required modules or acceptance criteria. They may be reconsidered only after all required modules pass verification:

- Guest experience in the Expo App.
- Automatic refunds through VNPay.
- Event types other than weddings.
- Multi-tenant support for multiple restaurants.

## Approved Build Order

1. `core-platform`
2. `identity-access`
3. `venue-catalog`
4. `booking-lifecycle`
5. `payments-billing` and `invitation-studio` in parallel
6. `guest-rsvp`
7. `seating-plan`
8. `staff-operations`
9. `notifications-automation`
10. `analytics-dashboard`
11. `release-demo`

Approved by the project owner on 2026-09-24.
