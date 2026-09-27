# ADR-001: Model Revised Wedding Operations with Existing Capabilities

## Status

Accepted

## Date

2026-09-26

## Context

The approved product direction adds five connected changes:

- timeline collaboration must happen before deposit;
- wedding photos are shared with the restaurant only after deposit;
- the seating plan selects a restaurant layout and labels tables by guest group instead of assigning people to seats;
- staff check in invitation households by name and actual arrival count instead of relying on per-recipient QR codes;
- physical invitation printing supports multiple variants and quantities, uses a generic public QR, and contributes accepted charges to booking receivables.

The existing capability map already defines stable module IDs and a 10-week academic delivery boundary. The decision must preserve an acyclic dependency graph, backend-authoritative rules, and practical scope.

## Decision

Keep the existing module IDs and allocate the revised behavior as follows:

- `identity-access` owns restricted prospect access and promotion of the same identity to full Couple access.
- `venue-catalog` owns reusable timeline templates and immutable seating-layout templates with supported capacity ranges.
- `booking-lifecycle` owns consultation workspaces, timeline revisions and approvals, deposit eligibility, and post-deposit timeline change requests.
- `payments-billing` owns accepted print charges and receivables.
- `invitation-studio` owns the post-deposit media library, generic public invitation QR, printable snapshots, and print-order fulfillment.
- `guest-rsvp` owns invitation households and guest-group definitions.
- `seating-plan` consumes layout templates and guest groups to label fixed tables.
- `staff-operations` owns manual multi-arrival check-in and audited attendance correction.
- `notifications-automation` and `analytics-dashboard` consume the resulting events and read models.

`invitation-studio` now depends on `payments-billing`; therefore the two capabilities are no longer approved as parallel top-level modules. Guest groups remain owned by `guest-rsvp` so seating can depend on them without creating a guest/seating dependency cycle.

The pre-deposit experience uses an authenticated restricted Web workspace. The physical-invitation QR is generic and public; it is not guest identity, RSVP authorization, or a check-in credential.

## Alternatives Considered

### Create New `event-planning`, `media-library`, and `print-fulfillment` Modules

- Pros: Narrower modules and clearer names for each new capability.
- Cons: More contracts, specifications, implementation checkpoints, and coordination within the fixed delivery window.
- Rejected: The behaviors fit existing ownership without cycles, and adding three modules would increase delivery risk more than it would improve separation.

### Grant Full Couple Access Before Deposit

- Pros: One permission set and fewer visible account states.
- Cons: Unconfirmed prospects would mix with paying customers and gain access to guest, media, invitation, seating, and print workflows too early.
- Rejected: A restricted workspace matches the sales process and preserves a clear commercial boundary.

### Use a Long-Lived Public Consultation Link

- Pros: Lowest sign-in friction.
- Cons: Forwarded links could expose proposals or permit unauthorized timeline edits; revocation and actor attribution would be weak.
- Rejected: An expiring bootstrap invitation followed by an authenticated session provides traceability without requiring a separate account after deposit.

### Keep Per-Guest Table Assignment and QR Check-In

- Pros: More precise seating and faster check-in when complete guest data exists.
- Cons: Requires detailed guest data, many physical QR codes, more correction work, and operational behavior that does not match the restaurant's area-guidance process.
- Rejected: Invitation-household check-in and guest-group table labels are more realistic and require less personal data.

### Let Print Orders Reference Live Invitation Data

- Pros: No snapshot model.
- Cons: A later timeline, seating, design, or price edit could silently change what an approved order is expected to print.
- Rejected: Approval must freeze printable and commercial revisions for auditability and reprint accuracy.

## Consequences

- The approved module IDs and repository topology remain unchanged.
- The dependency order becomes more sequential because invitation printing consumes billing.
- Backend authorization must distinguish restricted Prospect and full Couple capabilities without duplicating identities.
- Timeline and print approvals require immutable revision identities.
- Guest-group identifiers become a shared contract used by guests, seating, staff operations, and analytics.
- Exact guest seating, table-geometry editing, printed recipient names, per-recipient physical QR codes, and QR check-in are not required capabilities.
- Module specs must trace to `PRODUCT-REQUIREMENTS.md` and may refine deferred numeric limits without changing this decision.
