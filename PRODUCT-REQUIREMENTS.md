# Product Requirements: Wedding Collaboration and Event Operations

## 1. Document Status

- Status: Approved by project owner on 2026-09-26
- Capability index: `CAPABILITY-MAP.md`
- Platform baseline: `SPEC-core-platform.md`
- Decision rationale: `docs/decisions/0001-model-revised-wedding-operations-with-existing-capabilities.md`

This document is the cross-module product source of truth for the consultation, timeline, wedding-media, guest-group seating, event check-in, and physical-invitation printing workflows. Each affected `SPEC-<module-id>.md` must trace its requirements and tests to the identifiers in this document. This document does not replace a module specification or authorize implementation by itself.

## 2. Objective

Provide one continuous, auditable workflow in which a prospective couple collaborates with the restaurant before deposit, becomes a full Couple user after deposit, prepares event materials and guest-group seating, and supports practical name-based event check-in.

The product succeeds when:

- the restaurant and couple approve the same timeline revision before deposit;
- a successful deposit promotes the existing workspace without duplicating identity or consultation data;
- wedding photos remain private and unavailable before deposit;
- seating communicates guest areas without assigning individual guests to exact tables or seats;
- staff can check in invitation households even when members arrive separately or exceed the expected count;
- a print request can contain multiple invitation variants and quantities, with an approved quotation and immutable print content;
- the physical-invitation QR remains generic and cannot be mistaken for an attendance credential.

## 3. Actors and Terms

| Term                 | Meaning                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Prospective Couple   | An authenticated user invited to a restricted consultation workspace before deposit                                       |
| Couple               | The same identity after a successful deposit grants full wedding-management access                                        |
| Manager              | Restaurant user who configures templates, approves timelines, quotes print orders, and controls operational exceptions    |
| Staff                | Restaurant user assigned to event operations such as guest lookup and check-in                                            |
| Consultation         | The pre-deposit business record that owns proposal and timeline collaboration state                                       |
| Booking              | The wedding reservation that becomes confirmed according to the booking and payment policies                              |
| Timeline revision    | An immutable version of the proposed wedding schedule; approvals bind to one exact revision                               |
| Invitation household | One invitation record representing a person, couple, family, or party arriving under one representative name              |
| Guest group          | A named, colored category shared by invitation households and seating-plan table labels                                   |
| Layout template      | Restaurant-owned fixed geometry for a hall and supported guest-count range                                                |
| Printable revision   | An immutable snapshot of invitation design, approved timeline, seating content, and public QR used for a print-order line |

## 4. End-to-End Lifecycle

```text
Restaurant creates consultation
        |
Prospective Couple accepts restricted workspace invitation
        |
Restaurant proposes timeline <-> Couple edits and reviews revisions
        |
Both parties approve the same timeline revision
        |
Deposit becomes eligible
        |
Successful deposit promotes existing identity to full Couple access
        |
Media, invitations, guest list, seating, and print ordering become available
        |
Restaurant staff perform name-based, multi-arrival check-in on event day
```

Editing an approved timeline creates a new revision and invalidates approval only for the new revision. Before deposit, payment eligibility follows the newest mutually approved revision. After deposit, the previously approved timeline remains effective until a replacement revision completes the change-approval workflow.

## 5. Functional Requirements

### 5.1 Restricted Pre-Deposit Workspace and Access Promotion

- **ACC-001:** A restaurant Manager can create a consultation and request a restricted Web-workspace invitation for the prospective couple.
- **ACC-002:** The invitation is an expiring bootstrap credential. Accepting it establishes an authenticated session; the raw invitation token is not used as a permanent bearer credential.
- **ACC-003:** Before deposit, the prospective couple can access only proposal information and the timeline collaboration actions authorized by the consultation.
- **ACC-004:** Before deposit, the prospective couple cannot access wedding-media upload, invitation editing or delivery, guest management, seating, print ordering, or event operations.
- **ACC-005:** A successful deposit promotes the existing identity and consultation data to full Couple access. The system must not create a duplicate account or require the couple to re-enter the agreed timeline.
- **ACC-006:** Revoked or expired workspace invitations cannot establish new sessions. Revoking an invitation does not silently delete the consultation or its audit history.
- **ACC-007:** Authorization is enforced by the backend from current consultation, booking, payment, and account state; hiding a client control is not authorization.

### 5.2 Timeline Proposal, Revision, and Approval

- **TML-001:** The restaurant can create a proposed timeline from a reusable template or from an empty schedule.
- **TML-002:** A timeline contains ordered items with a start time, title, and optional description. Authorized editors can add, edit, remove, and reorder items while the revision is editable.
- **TML-003:** Saving a substantive change creates a new immutable revision identity. The system records the author, timestamp, and relationship to the preceding revision.
- **TML-004:** Restaurant approval and Couple approval each bind to an exact revision. Editing that revision produces a successor without carrying either approval forward.
- **TML-005:** Deposit is unavailable until the same timeline revision has both active approvals.
- **TML-006:** The deposit attempt rechecks approval eligibility on the backend so a stale client cannot pay against a superseded revision.
- **TML-007:** After deposit, the effective timeline is locked. A proposed change creates a replacement revision and follows a restaurant-and-Couple approval workflow while the previous effective revision remains valid.
- **TML-008:** Timeline approval, withdrawal, supersession, and post-deposit replacement are audited.

### 5.3 Post-Deposit Wedding Media

- **MED-001:** Wedding-media access is available only to a full Couple account and authorized restaurant users after successful deposit.
- **MED-002:** The couple can upload multiple wedding photos, preview them, and replace or delete them before the restaurant-defined cutoff.
- **MED-003:** Authorized restaurant users can preview and download original accepted files for agreed invitation design, printing, venue display, or decoration work.
- **MED-004:** Media is private by default and delivered through short-lived authorized access. Public invitation pages do not expose the private media library unless a separate invitation design deliberately publishes a derived asset.
- **MED-005:** Uploads follow the platform file-validation rules for allowlisted type, verified content, bounded size and dimensions, generated object keys, and audit-safe metadata.
- **MED-006:** In-system photo editing, public photo albums, and unrestricted post-cutoff mutation are outside the required scope.

### 5.4 Invitation Households and Guest Groups

- **GST-001:** One guest-list record represents one invitation household or party rather than requiring one record per attendee.
- **GST-002:** An invitation household contains a representative name, optional phone or other approved disambiguating contact, guest-group assignment, expected attendee count, and optional operational note.
- **GST-003:** Expected attendee count is a positive integer and does not require the names of companions.
- **GST-004:** Each wedding starts with the groups `Parents`, `Groom Side`, `Bride Side`, and `Friends`; the UI presents localized Vietnamese labels.
- **GST-005:** The couple can add custom groups and select their display colors. Names must be unique within a wedding after normalization, and colors are presentation metadata rather than authorization or identity.
- **GST-006:** The same guest-group identifier is used by invitation households, seating-plan table labels, staff guidance, and grouped attendance reporting.
- **GST-007:** A group referenced by a household, confirmed seating plan, or attendance record cannot be destructively removed. Rename or archival behavior must preserve historical meaning.
- **GST-008:** Personalized electronic invitation links and RSVP may exist independently of the generic physical-invitation QR.

### 5.5 Fixed Layout Selection and Table-Level Group Labels

- **SEA-001:** The restaurant creates layout templates for a specific hall with a minimum and maximum supported guest count.
- **SEA-002:** A layout template owns fixed geometry and stable table identifiers. Couple users cannot move, add, or remove tables or alter the supported capacity range.
- **SEA-003:** The system filters or ranks available layouts using the booking's expected headcount.
- **SEA-004:** The couple can select one compatible layout and apply a guest-group label and its color to individual tables.
- **SEA-005:** The system does not assign an invitation household or individual guest to a specific table or seat.
- **SEA-006:** If expected headcount moves outside the selected layout's supported range, the existing selection and group definitions remain visible, but the plan cannot be confirmed until a compatible layout is selected or a Manager records an explicit exception.
- **SEA-007:** Changing layout does not delete guest-group definitions. Table-label assignments may be remapped to the new template.
- **SEA-008:** Any drag interaction is limited to applying a group label to a table; it must not imply movable restaurant geometry or individual guest placement.

### 5.6 Manual, Multi-Arrival Event Check-In

- **CHK-001:** Assigned Staff can search invitation households by representative name and optionally use phone data to disambiguate duplicate names.
- **CHK-002:** Search results show the guest group, group color, expected attendee count, cumulative actual attendee count, and operational notes allowed for Staff.
- **CHK-003:** One invitation household can receive multiple arrival records when its attendees arrive separately.
- **CHK-004:** Each arrival records a positive attendee count, event time, acting Staff identity, and invitation-household identity. Actual attendance is the sum of valid arrivals and corrections.
- **CHK-005:** When cumulative actual attendance exceeds the expected count, the UI and API return a warning but do not block the arrival.
- **CHK-006:** Corrections preserve an audit trail; a prior arrival must not disappear through an unaudited overwrite or hard delete.
- **CHK-007:** After check-in, Staff guide the party to the area represented by its guest-group label and color, not to a reserved personal table or seat.
- **CHK-008:** QR scanning is not required for physical-invitation check-in and is not a fallback authorization mechanism.

### 5.7 Physical-Invitation Print Orders

- **PRN-001:** A full Couple account can create a draft physical-invitation print order after deposit.
- **PRN-002:** One print order can contain multiple lines. Each line selects an invitation design variant and a positive quantity, such as 50 copies of one variant and 100 of another.
- **PRN-003:** The restaurant supplies a unit price, line total, order total, and estimated completion or handover date before Couple approval.
- **PRN-004:** Couple approval captures an immutable printable revision for every line. The snapshot includes the chosen design, required event information, approved timeline content, selected seating-plan content, and generic public QR applicable at approval time.
- **PRN-005:** Later edits to the live invitation, timeline, or seating plan do not mutate an approved printable revision. A corrected print run requires a new revision or order action with an explicit cost consequence.
- **PRN-006:** The accepted print charge is registered with `payments-billing` as part of booking receivables and appears on the relevant billing view or invoice.
- **PRN-007:** Required print states are `REQUESTED`, `QUOTED`, `APPROVED`, `IN_PRODUCTION`, `READY_FOR_HANDOVER`, `HANDED_OVER`, and `CANCELLED`; module specifications must define authorized transitions and cancellation limits.
- **PRN-008:** Printed invitations contain no recipient name. Handwritten recipient names remain an offline activity.
- **PRN-009:** Quotation changes after Couple approval require renewed approval and a new immutable commercial revision.

### 5.8 Generic Physical-Invitation QR

- **QRC-001:** All physical invitation variants for one wedding use one generic wedding QR unless a future approved scope change states otherwise.
- **QRC-002:** The QR opens a public electronic invitation containing only approved public event content.
- **QRC-003:** Scanning the generic QR does not identify an invitation household, expose a guest group, perform RSVP on behalf of a guest, or submit event check-in.
- **QRC-004:** The public identifier is an unguessable opaque value but is not treated as proof of guest identity or authorization.
- **QRC-005:** Personalized direct electronic-invitation links remain a separate `guest-rsvp` capability and must be visually and technically distinguishable from the generic QR destination.

### 5.9 Notifications and Reporting

- **OPS-001:** Notification events cover workspace invitation, timeline review requested, timeline approval or supersession, deposit eligibility, media cutoff, print quotation, print approval, and print handover readiness where the corresponding module enables notification delivery.
- **OPS-002:** Operational notifications contain no private image attachment, raw access token, full guest list, or unnecessary PII.
- **OPS-003:** Reporting can compare expected and actual attendance by invitation household and guest group without inventing per-seat occupancy.
- **OPS-004:** Print reporting uses accepted commercial totals and current fulfillment state; draft quotations do not count as receivables.

### 5.10 Requirement Ownership

Every requirement has one authoritative provider. A provider may call another module through its published contract, but consumers do not reimplement the rule.

| Provider module            | Requirements owned                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `identity-access`          | ACC-002 through ACC-007                                                                            |
| `venue-catalog`            | SEA-001, SEA-002                                                                                   |
| `booking-lifecycle`        | ACC-001, TML-001 through TML-008                                                                   |
| `payments-billing`         | PRN-006                                                                                            |
| `invitation-studio`        | MED-001 through MED-006; PRN-001 through PRN-005; PRN-007 through PRN-009; QRC-001 through QRC-004 |
| `guest-rsvp`               | GST-001 through GST-008; QRC-005                                                                   |
| `seating-plan`             | SEA-003 through SEA-008                                                                            |
| `staff-operations`         | CHK-001 through CHK-008                                                                            |
| `notifications-automation` | OPS-001, OPS-002                                                                                   |
| `analytics-dashboard`      | OPS-003, OPS-004                                                                                   |

## 6. Commands

The implementation uses the exact repository commands defined by `SPEC-core-platform.md`. At minimum, an affected repository must pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
```

Backend changes additionally require the relevant integration and contract suites once those scripts exist:

```bash
npm run test:integration
npm run test:contract
npm run api:generate
npm run api:check
```

The Expo application additionally requires `npx expo-doctor`. A module plan must use commands that actually exist at implementation time and must add missing platform-required scripts before claiming completion.

## 7. Project Structure and Ownership

- `wedding-be/src/modules/<module-id>/` owns authoritative business rules, state transitions, persistence ports, and API schemas.
- `wedding-web/app/(couple)/` owns the restricted pre-deposit Web experience and full Couple Web experience.
- `wedding-web/app/(guest)/` owns public and personalized electronic-invitation experiences.
- `wedding-manage-web/app/(manager)/` owns templates, approvals, quotations, and operational administration.
- `wedding-manage-web/app/(staff)/` owns guest lookup and event check-in.
- `wedding-app/src/features/` may expose full Couple workflows after deposit; it does not own pre-deposit authorization or business rules.
- `docs/decisions/` records cross-module decisions that would be costly to rediscover or reverse.

No client repository persists authoritative copies of approval, billing, check-in, or authorization rules.

## 8. Code and Contract Style

All implementations follow `SPEC-core-platform.md`: TypeScript strict mode, kebab-case files, PascalCase types, camelCase functions and variables, Zod at external boundaries, generated OpenAPI client types, integer VND amounts, UUID resource identifiers, UTC storage, and `Asia/Ho_Chi_Minh` business-time interpretation.

Stable API and domain names should use the requirement vocabulary in this document. Avoid misleading names such as `SeatAssignment`, `GuestQrCredential`, or `AccountAfterDeposit` when the actual concepts are `GuestGroupTableLabel`, `GenericInvitationQr`, and access promotion of an existing identity.

## 9. Testing Strategy

Each module specification must map automated tests to the requirement identifiers it owns. Required cross-module scenarios include:

1. A pre-deposit user is allowed to edit timeline content and denied media, guests, seating, and print endpoints.
2. An edit after one or both timeline approvals produces a new revision and deposit remains unavailable until both parties approve that revision.
3. Deposit eligibility is rechecked transactionally when payment starts.
4. Successful deposit promotes access without duplicating the user or consultation.
5. Private media cannot be read by a public invitation or another booking.
6. A guest group remains stable across household, table label, check-in guidance, and reporting.
7. A headcount change outside the selected layout range blocks confirmation without deleting the prior draft.
8. Separate arrivals accumulate attendance; an over-expected arrival succeeds with a warning; correction history remains auditable.
9. Print approval freezes design, timeline, seating content, QR, and price revisions.
10. The generic QR never resolves to personalized guest data or a check-in mutation.

Concurrency tests are required for timeline approvals versus edits, payment eligibility versus supersession, simultaneous household arrivals, and print quotation versus approval. Authorization tests must exercise backend endpoints directly, not only hidden UI controls.

## 10. Boundaries

### Always do

- Enforce state and authorization rules in `wedding-be`.
- Bind approvals to immutable revisions and preserve audit evidence.
- Treat wedding photos, guest contacts, access tokens, and operational notes as private data.
- Preserve existing identity and consultation data when access is promoted after deposit.
- Represent actual attendance as auditable arrivals and corrections.
- Freeze printable and commercial content when a print order is approved.

### Ask the project owner first

- Change which pre-deposit features are visible in the restricted workspace.
- Introduce a new default guest group or make an existing default group undeletable for a new reason.
- Allow layout confirmation outside the configured capacity range without Manager approval.
- Send private wedding media to a third-party processor or printing provider.
- Add automatic printer/vendor integration, shipment tracking, or a new payment collection step.
- Change the public QR into a personalized, RSVP, or check-in credential.

### Never do

- Permit deposit against a timeline revision that lacks both active approvals.
- Enable wedding-media upload before successful deposit.
- Create a second Couple identity when promoting a consultation.
- Let Couple users edit restaurant layout geometry or assign individual guests to exact tables or seats.
- Block a real arrival only because actual attendees exceed the expected count.
- Mutate an approved printable revision in place.
- Put recipient names or per-recipient QR credentials into the required physical-print workflow.
- Expose private photos, guest data, phone numbers, or operational notes on the generic public invitation.

## 11. Acceptance Criteria

This product revision is specified when:

- every functional requirement is allocated to exactly one provider module and any consumers depend in the direction recorded by `CAPABILITY-MAP.md`;
- affected module specs cite the requirement identifiers they implement;
- API contracts distinguish restricted prospect access from full Couple access;
- timeline, seating-plan, print-order, and attendance states have explicit authorized transitions;
- public QR behavior is separated from personalized invitations and staff check-in;
- security, audit, concurrency, and data-retention rules are specified before the owning module is implemented;
- module plans include automated evidence for the cross-module scenarios in Section 9;
- no implementation reintroduces exact guest seating or per-recipient physical QR codes without an approved product revision.

## 12. Deferred Configuration Decisions

The product scope is closed. The following numeric or operational values are intentionally deferred to the owning module spec because they do not change the approved workflow:

- workspace invitation lifetime and reissue limits;
- upload MIME allowlist, per-file size, dimensions, per-booking quota, and media cutoff policy;
- exact timeline item validation and notification lead times;
- default layout range boundaries and Manager exception reason requirements;
- print cancellation deadline, quotation expiry, supported paper/finish options, and fulfillment service levels;
- guest-search ranking and the operational process for unresolved duplicate names.
