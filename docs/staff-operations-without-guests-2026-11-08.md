# Assigned event operations without named guests — 2026-11-08

## Owner-approved scope

The owner approved the preceding consultation and explicitly requested implementation
on 2026-11-08. This revision may change wedding-be, wedding-manage-web, wedding-web
and the Couple PRM-app. It supersedes optional named-Guest/check-in requirements
for active product behavior, not historical evidence or applied migrations.

- Manager provisions/reuses Staff accounts, assigns/revokes staff for a settled
  confirmed/completed event, creates/reassigns tasks and resolves incidents.
- Staff sees only currently assigned events, approved operational information,
  timeline, seating and team. Staff updates own unfinished tasks, reports incidents,
  creates handovers and acknowledges handovers addressed to them. Authors cannot
  acknowledge their own handovers. Manager receives unaddressed handovers.
- Retire named guest list/search/CRUD/import, new personalized invitation issuance
  and delivery, check-in configuration and all new check-in/undo operations for all
  roles. Authenticated obsolete HTTP routes return 410 FEATURE_RETIRED. Preserve
  previously issued read-only invitation access and immutable historical records.
- Couple retains separately entered planning headcount, groups/colors, group-based
  seating, generic invitation sharing/QR and printing. No named guest list is loaded
  by Couple Web or Android. Legacy named rows must not prevent group archival.
- No attendance is inferred, zeroed or used for billing. Staff gets no prices,
  financial documents or commercial write permissions. Preserve all financial guards.
- No database reset/drop/backfill is required; no applied migration is modified.

## Implementation and verification order

1. Retire HTTP operations and document the 410 contract; remove attendance/settings
   from the Staff workspace and keep authorization independent of former check-in.
2. Complete Manager personnel selection/provision/assignment/revocation and Staff
   overview/work/incident/handover UX, including stale-data and revoked-access cases.
3. Replace Couple named-list/check-in UI with planning/groups on Web and Android;
   keep seating and generic invitations. Remove misleading navigation/copy.
4. Run focused regression tests, types/lint/OpenAPI, required typography tests,
   builds and local desktop/mobile browser checks. Integration DB tests use only
   disposable databases on the existing loopback test administrator.

## Commands and conventions

Backend: `npm run typecheck`, `npm run lint`, `npm run api:generate`,
`npm run api:check`, `npm test`, `npm run build`.
Manager/Couple Web: `npm test`, `npm test -- src/design-system/typography.test.ts`,
`npm run typecheck`, `npm run lint`, `npm run build`.
PRM-app: `flutter analyze`, `flutter test`; do not build APKs.
Use existing strict Zod DTOs, booking-scoped transactions, expectedRevision,
Idempotency-Key and append-only audit. Keep code in existing module/feature owners.

## Evidence

Implementation and local verification are tracked in tasks/backend-revision-todo.md.
Deployment and live external-provider acceptance are separate and are not implied.
Final local results and broader-suite limitations:
[verification evidence](../tasks/evidence/staff-operations-without-guests-2026-11-08.md).

## API examples and cutover

`GET /api/v1/staff/events/{bookingId}/workspace` replaces settings, attendance,
listedGuestCount and check-in windows with `operations`:

```json
{
  "phase": "CONFIRMED",
  "brideName": "Lan",
  "groomName": "Minh",
  "tableCount": 15,
  "offerings": [
    {
      "category": "MENU",
      "name": "Thực đơn đã chốt",
      "description": "Nội dung thực đơn",
      "unit": "bàn",
      "quantity": 15
    }
  ]
}
```

The enclosing workspace retains bookingId/code/alias, planningHeadcount, isManager,
approved timeline, seating and active members. ABSENT seating accepts only an empty
snapshot; other seating states keep the existing validated nonempty render contract.
Staff can refresh event information explicitly. Commercial invalidations reach
Manager through existing authorized realtime audiences; no contract/billing events
or payloads are newly disclosed to Staff.

Handovers retain their recipient at acknowledgement. Only that recipient may accept,
or a Manager for an unaddressed handover, and never its author or an already completed
handover. Existing expectedRevision, idempotency and current-assignment checks apply.

Retired authenticated routes return 410 without requiring their former body or
Idempotency-Key. Unauthenticated requests return 401; neither response is cacheable.
The published OpenAPI marks these paths deprecated with 401/410 responses. Existing
invitation capability exchange/view and owner historical attendance summary remain.

This is an intentional breaking product cutover. Release the reviewed backend and
updated Manager/Couple Web/PRM clients together; old clients must update instead of
retrying retired operations. No SQL data migration is necessary. Existing released
frontend OpenAPI pins are preserved; the new Staff DTO is runtime-validated locally.
Repin generated clients only to an actual released backend commit, never an invented
release hash. Rollback restores application versions, without modifying history.
