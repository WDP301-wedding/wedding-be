# Staff workspace and check-in — 2026-11-03

Active behavior is superseded by the owner-approved
[assigned-event revision of 2026-11-08](./staff-operations-without-guests-2026-11-08.md).
Named lists, check-in and new personalized issuance are retired. The text below
records the earlier implementation and its historical acceptance guide.

## Scope and permissions

Changes cover wedding-be and wedding-manage-web only. No Couple app or customer
web changes, payment execution, or financial recalculation. Existing check-in
rules remain: explicit opt-in by booking, named guests only, settled confirmed
(or retained completed) event, current assignment for Staff, server time window,
reasoned Manager override, append-only corrections. Check-in totals are never
whole-event attendance or a billing input. NONE means not recorded, never zero.

Staff workspace admission is separate from check-in admission. Assigned Staff can
read the approved timeline, read seating, see operational work and report incidents
or handovers even while check-in is disabled/outside its window. This does not
allow guest search or attendance writes through those inactive guards. Weak scope
capabilities for guest operations and seating are distinct.

| Operation                      | Manager                                                       | Currently assigned Staff                           |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------- |
| List events                    | Settled confirmed/completed scope                             | Own active assignments only                        |
| Configure named check-in       | Explicit enable/disable, locked after first journal record    | No                                                 |
| Search/check in                | Enabled mode; writes require reason; may override window only | Enabled mode, active assignment, within window     |
| Undo check-in                  | Reason, exact guest journal revision and record               | Own effective check-in only, reason, within window |
| View approved timeline/seating | Yes                                                           | Assigned event; read-only                          |
| Create TASK                    | Yes                                                           | No                                                 |
| Update TASK                    | Coordinate/reassign/reopen                                    | Own assigned unfinished task                       |
| Report INCIDENT                | Yes                                                           | Yes                                                |
| Accept/resolve INCIDENT        | Yes                                                           | No                                                 |
| Create HANDOVER                | Yes                                                           | Yes; cannot address self                           |
| Acknowledge HANDOVER           | Different person from author                                  | Different assigned recipient from author           |
| Read work/history              | Yes                                                           | Same assigned event                                |

No delete endpoint. Reassignment checks active STAFF role and current assignment
in the booking boundary. Updates require exact expectedRevision. Staff cannot
choose another assignee through PATCH. History retains actor, revision, time and
submitted note. Revoked assignments fail future reads/writes, including command
replay. No global booking search permission is granted to Staff.

## API additions

All paths relative to /api/v1, private no-store, bearer auth. Writes additionally
require Idempotency-Key and reject unknown fields.

- GET /staff/events: q, phase=CONFIRMED|COMPLETED, afterId, limit<=50; scoped UUID-keyset page.
- GET /staff/events/{bookingId}/workspace: approved timeline, seating geometry,
  assigned team, check-in settings, server window and safe attendance counts.
- GET /staff/events/{bookingId}/work-items: kind, afterId, limit<=50; newest-first
  cursor pagination by creation time and unique ID. Cursor anchor must belong to
  the same booking/kind.
- POST /staff/events/{bookingId}/work-items: kind=TASK|INCIDENT|HANDOVER,
  title, description, priority=NORMAL|URGENT, assignedAccountId nullable.
- PATCH /staff/events/{bookingId}/work-items/{itemId}: expectedRevision,
  status=OPEN|IN_PROGRESS|DONE, note, optional assignedAccountId for Manager.
- GET /staff/events/{bookingId}/work-items/{itemId}/history: afterRevision,
  maximum 25 ascending immutable revisions and nextAfterRevision.

Existing named guest search adds optional checkInRecordId. Undo fallback reads the
specific expected guest revision, not the first 50 historical records. Assignment
list adds optional staffLabel from one batched account lookup. Existing routes
remain compatible. The client validates new response extensions locally until
there is a released backend commit to pin; do not invent immutable pin provenance.

Operational work/configuration changes emit staff.updated, delivered to Manager
and current assigned Staff, not Couple. Attendance uses existing guest.updated.
Assigned Staff may also receive seating/timeline invalidations, never contract or
billing payloads. Clients refetch authoritative reads and keep edited work snapshots
bound to their original expectedRevision. No draft is silently replaced.

Client command keys/hashes persist in session storage for unknown outcomes. Revision
bound actions use revision-specific slots; altered unresolved create contents are
blocked rather than silently generating another key. Guest duplicate check-in and
undo concurrency remain server-enforced. No report contents or credentials are
stored by the intent helper.

## Migration and rollout

New forward migration: 20261103010000_staff_workspace_work_items. Adds only
StaffWorkItem plus scoped indexes, foreign keys and enum-like CHECK constraints.
Existing StaffHistory/StaffCommand store audit and durable idempotent command results.
No applied migration is edited, and no financial/history rows are rewritten.

Deploy BE and apply pending migrations BEFORE Manager. Current Render startup uses
scripts/render-start.sh; verify it successfully completes migration deployment.
For a manual authorized migration run npm run db:migrate:deploy with the correct
MIGRATION_DATABASE_URL already configured securely. Never paste connection secrets
into reports. No new env vars. Applying the shared database migration and deploying
are separate from the source implementation; they have not been performed here.

## Manual UI acceptance guide (not executed)

1. Manager opens **Nhân sự & Tác nghiệp**. Load/search the event list, choose a
   settled confirmed party by HY code, hall and date. Verify no UUID entry required.
2. In **Nhân sự**, enter a staff email to prepare/reuse its account, then assign it
   to the selected party. New Staff sets password through the existing password
   reset/setup flow; provisioning does not claim to deliver a setup email.
3. Add at least one named guest through the existing Manager/Couple guest UI.
   On **Điều kiện đón khách**, click **Bật check-in theo tên** explicitly.
4. Staff signs in, selects the assigned party and sees mode, server opening/closing
   times, planning count, listed count and measured check-ins separately.
5. During the operational window, search by at least two characters of name/phone.
   Check a guest in, use another Staff browser to observe the refreshed state.
   Confirm the same identity cannot be checked in twice; use **Tải thêm khách**.
6. Undo one's own check-in with reason. Another Staff cannot undo it. Manager may
   correct with an explicit reason and can act outside the window. Mode cannot be
   disabled after any journal record, including after every check-in is undone.
7. Change party/search while a request is pending: old guests and assignments must
   not become actionable in the new party. Check long guest-history undo paths.
8. With check-in disabled or outside the window, **Kịch bản tiệc**, **Sơ đồ bàn**
   and **Công việc & Bàn giao** remain usable; guest search/check-in remains blocked.
   Draft/requires-review seating must display a warning, not claim to be final.
9. Manager creates a task for an assigned Staff. Staff starts/completes it; another
   Staff cannot mutate it. Manager can reassign/reopen with a recorded note.
10. Staff reports an urgent incident. Manager accepts/resolves it with a note.
    Staff can read its progress/history but cannot resolve it themselves.
11. Staff creates a handover to another assigned person or Manager. The author
    cannot acknowledge it. The recipient confirms receipt with a note.
12. View and paginate history. Update one item from two sessions: the stale revision
    must be rejected and edits preserved. Simulate a network interruption manually
    only in a safe environment and retry unchanged contents with the retained key.
13. Revoke Staff assignment: further access/actions must be denied, without gaining
    access to other bookings or financial operations. Check completed event filter.

Automated tests, live check-in writes, provider calls and deployed browser acceptance
were not executed. Lint/type/OpenAPI/Prisma checks are separate source validations.
