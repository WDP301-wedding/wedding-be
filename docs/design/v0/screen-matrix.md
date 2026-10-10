# Screen matrix — proposed information architecture

The following are UX groupings derived from requirements, not a claim that every route/API is implemented. Screen IDs are design IDs, not replacements for approved task IDs. Several screens may share a route, drawer or sheet. v0 rendering and runtime QA have not been performed.

| ID | Surface | Screen / main job | Source |
| --- | --- | --- | --- |
| W01 | Web public | Restaurant story, active halls/menu, enter consultation flow | CAPABILITY-MAP; SPEC-venue-catalog §§1–5; SPEC-booking-lifecycle |
| W02 | Web public | Hall/menu detail with published information | SPEC-venue-catalog |
| W03 | Web identity | Login/reset/accept workspace invitation; expired/revoked states | SPEC-identity-access; ACC-002/006 |
| W04 | Restricted Web | Proposal, booking facts, access limitations | SPEC-booking-lifecycle; ACC-003/004 |
| W05 | Restricted Web | Timeline editor, revision history, exact revision approval | TML-001..006; SPEC-booking-lifecycle |
| W06 | Restricted Web | Eligible deposit and pending/verified/failure outcome | SPEC-payments-billing §§5/7–9; TML-005/006 |
| W07 | Couple Web | Wedding overview and next useful action | CAPABILITY-MAP; SPEC-booking-lifecycle |
| W08 | Couple Web | Effective timeline and replacement/change request | TML-007/008; SPEC-booking-lifecycle |
| W09 | Couple Web | Private media list/upload/preview/replace/tombstone and cutoff | MED-001..006; SPEC-05 §§5/7 |
| W10 | Couple Web | Template selection and invitation variants | SPEC-05 §§1/7; PRN-002 |
| W11 | Couple Web | Full structured invitation editor, safe AI background generation | SPEC-05 §§1/7/9 |
| W12 | Couple Web | Publish/unpublish, public preview, generic QR/share | QRC-001..004; SPEC-05 §§7/9 |
| W13 | Couple Web | Multi-variant print request, quantity by line | PRN-001/002; SPEC-05 §8 |
| W14 | Couple Web | Exact quote approval, expiry, frozen print preview and fulfillment | PRN-003..009; SPEC-05 §8 |
| W15 | Couple Web | Replacement proposal and approved-order cancellation confirmation | SPEC-05 §8; SPEC-payments-billing |
| W16 | Couple Web | Household list/add/edit/archive with group and RSVP | GST-001..008; SPEC-06 §§2/7/9 |
| W17 | Couple Web | Guest groups and color management | GST-004..007; SPEC-06 §7 |
| W18 | Couple Web | Personalized link/send/share, deadline, delivery state | SPEC-06 §§8/9; SPEC-notifications-automation |
| W19 | Guest Web | Personalized invitation and RSVP/attendee count; expired/deadline states | QRC-005; SPEC-06 §§7/8 |
| W20 | Public Web | Generic public invitation, approved event/timeline/derived assets only | QRC-001..004; SPEC-05 §7 |
| W21 | Couple Web | Compatible fixed-layout selection and group table labels | SEA-003..008; SPEC-seating-plan |
| W22 | Couple Web | Billing/ledger/invoice view and authorized balance payment | PRN-006; SPEC-payments-billing §§7/9 |
| W23 | Couple Web | Cancellation request and notifications/status entry points | SPEC-booking-lifecycle; OPS-001/002 |
| M01 | Manage identity | Manager/Staff login and permission-aware entry | SPEC-identity-access |
| M02 | Manager | Operational overview with genuinely sourced queues | SPEC-booking-lifecycle; SPEC-analytics-dashboard |
| M03 | Manager | Availability by date/hall/LUNCH-DINNER; temporary holds | SPEC-booking-lifecycle |
| M04 | Manager | Consultations, restricted workspace invite and proposals | ACC-001; SPEC-booking-lifecycle |
| M05 | Manager | Booking detail, timeline revision comparison/approval/change | TML-001..008; SPEC-booking-lifecycle |
| M06 | Manager | Restaurant/shifts/halls/dishes/menus catalog maintenance | SPEC-venue-catalog |
| M07 | Manager | Versioned timeline and layout template editors | SEA-001/002; SPEC-venue-catalog |
| M08 | Manager | Manual payment, reconciliation, ledger, invoice/manual refund | SPEC-payments-billing §§5/7/9 |
| M09 | Manager | Invitation template list/create/revise/archive | SPEC-05 §§5/7 |
| M10 | Manager | Accepted originals preview/download and explicit cutoff policy | MED-003/004; SPEC-05 §7 |
| M11 | Manager | Print-order queue and order detail | PRN-007; SPEC-05 §8 |
| M12 | Manager | Quote/requote by line, total, expiry, estimated handover | PRN-003/009; SPEC-05 §8 |
| M13 | Manager | Replacement and Couple-confirmed approved cancellation | SPEC-05 §8; SPEC-payments-billing |
| M14 | Manager | Production/ready/handover with evidence | PRN-007; SPEC-05 §8 |
| M15 | Manager | Household import/export, row-safe validation and RSVP deadline | SPEC-06 §§7–9 |
| M16 | Manager | Seating compatibility review and audited exception | SEA-006; SPEC-seating-plan |
| M17 | Manager | Staff provisioning and event assignments | SPEC-staff-operations |
| M18 | Staff | Assigned events and scoped household lookup | CHK-001/002; SPEC-staff-operations |
| M19 | Staff | Add arrival, cumulative count, over-expected warning, group guidance | CHK-003..005/007/008 |
| M20 | Staff | Attendance ledger and correction with reason/audit | CHK-006; SPEC-staff-operations |
| M21 | Manager | Attendance by household/group, print fulfillment, billing reports | OPS-003/004; SPEC-analytics-dashboard |
| M22 | Manager | Notification delivery/retry evidence where exposed by approved contracts | OPS-001/002; SPEC-notifications-automation |
| A01 | Android | Login/session restore and FULL/confirmed access gate | SPEC-identity-access; SPEC-booking-lifecycle §5 |
| A02 | Android | Couple overview, next action, dates and milestones | CAPABILITY-MAP; product-patterns |
| A03 | Android | Effective timeline, allowed review/change flows | TML-007/008; SPEC-booking-lifecycle |
| A04 | Android | Private media access and permitted pre-cutoff actions | MED-001..006; SPEC-05 |
| A05 | Android | Invitation preview and quick text-only edit | SPEC-05 §§1/7 |
| A06 | Android | Generic invitation/QR sharing | QRC-001..004; SPEC-05 |
| A07 | Android | Print quote/status detail and permitted Couple actions | SPEC-05 §8; generated contract required for integration |
| A08 | Android | Household/group list, add/edit and personalized sharing | GST-001..008; SPEC-06 |
| A09 | Android | Seating read/compatible selection/group labels where client scope permits | SEA-003..008; SPEC-seating-plan |
| A10 | Android | Safe billing/progress/invoice and authorized payment views | SPEC-payments-billing |
| A11 | Android | Notifications and session/account controls | SPEC-identity-access; OPS-001/002 |

## States to design alongside screens

Restricted access; missing booking; expired bootstrap/link; empty data; uploading/validation failure; media cutoff; quote expired; stale revision; dependency unavailable; unknown payment outcome; proposal waiting for the other party; replacement pending; forbidden production/cancellation transition; RSVP deadline; seating incompatible/requires review; attendance over expected; permission denied; loading/retry/success.

Prototype fixture: use one fictional restaurant/event with coherent date, hall, menu and timeline. Guest representative names may be fictional; no real contact data. Payments/quotes must not imply that a pending quote is a receivable or that a redirect verifies settlement.
