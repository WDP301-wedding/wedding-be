import {
  eventListQuery,
  eventListSchema,
  workspaceSchema,
  workPageQuery,
  workPageSchema,
  workCreateInput,
  workUpdateInput,
  workItemSchema,
  workHistoryQuery,
  workHistorySchema,
} from '../domain/workspace-policy.js';
import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  configurationInput,
  assignmentInput,
  revokeInput,
  provisionInput,
  staffDirectoryQuery,
  staffDirectorySchema,
  operationalInput,
  checkInInput,
  undoInput,
  searchInput,
  pageInput,
} from '../domain/staff-policy.js';
import { attendanceSchema } from '../application/attendance-readers.js';
import {
  settingsSchema,
  assignmentSchema,
  provisionSchema,
  operationalSchema,
  recordSchema,
  searchSchema,
  historySchema,
} from './staff.schemas.js';
type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
const parameter = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const op = (
  operationId: string,
  output: z.ZodType,
  description: string,
  body?: z.ZodType,
  status = '200',
  example?: unknown,
): Operation => ({
  operationId,
  tags: ['Staff operations'],
  security: [{ bearerAuth: [] }],
  description: `${description} Private no-store. Strict schemas reject unknown body/query fields. Cross-event identities are concealed. Writes require a durable Idempotency-Key; identical replay returns the original result only after current authorization is rechecked. Changed same-key payload returns 409 IDEMPOTENCY_KEY_REUSED.`,
  ...(body === undefined
    ? {}
    : {
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: body, ...(example === undefined ? {} : { example }) },
          },
        },
      }),
  responses: {
    [status]: {
      description: 'Authorized result.',
      content: { 'application/json': { schema: z.strictObject({ data: output }) } },
    },
    '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': {
      description:
        'EVENT_ASSIGNMENT_REQUIRED, CHECK_IN_DISABLED, CHECK_IN_WINDOW_CLOSED, MANAGER_OVERRIDE_REQUIRED or CHECK_IN_CORRECTION_FORBIDDEN.',
      content: {
        'application/json': {
          schema: z.strictObject({
            error: z.strictObject({ code: z.string(), message: z.string(), requestId: z.uuid() }),
          }),
        },
      },
    },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { $ref: '#/components/responses/Conflict' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
  },
});
const booking = parameter('bookingId'),
  guest = parameter('guestId');
const guestPath = '/staff/events/{bookingId}/guests/{guestId}';
const operationDescription =
  'Current Staff role, active event assignment and BY_GUEST_NAME required. Staff writes within event start - 2h through end + 12h; Manager writes require explicit overrideReason and may override the window only. One listed identity, never all-person attendance; companions are not counted by this API. No invitation/QR authority.';
export const staffOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/staff/events': {
    get: {
      ...op(
        'listStaffEvents',
        eventListSchema,
        'Manager sees settled events; Staff sees only currently active assigned settled events. Keyset pagination by booking UUID; no cross-account event lookup.',
      ),
      requestParams: { query: eventListQuery },
    },
  },
  '/staff/events/{bookingId}/workspace': {
    parameters: [booking],
    get: op(
      'readStaffWorkspace',
      workspaceSchema,
      'Assigned Staff or Manager. Approved timeline, seating, assigned team, explicit planningHeadcount, separate bride/groom names, table count and approved menu/service names, descriptions and quantities. Effective mutually approved appendices override contract offerings. Legacy events use retained proposal facts. No named guests, attendance, check-in windows, prices or financial documents. Assignment revocation denies subsequent access.',
    ),
  },
  '/staff/events/{bookingId}/work-items': {
    parameters: [booking],
    get: {
      ...op(
        'listStaffWorkItems',
        workPageSchema,
        'Assigned Staff or Manager. Bounded newest-first keyset pagination by creation time and UUID; afterId must identify an item in this booking/kind.',
      ),
      requestParams: { query: workPageQuery },
    },
    post: op(
      'createStaffWorkItem',
      workItemSchema,
      'Manager creates TASK; assigned Staff/Manager may report INCIDENT or HANDOVER. Assignees must be current active staff assigned to the same booking. Immutable audit snapshot.',
      workCreateInput,
      '201',
    ),
  },
  '/staff/events/{bookingId}/work-items/{itemId}': {
    parameters: [booking, parameter('itemId')],
    patch: op(
      'updateStaffWorkItem',
      workItemSchema,
      'Exact expectedRevision required. Manager coordinates incidents/tasks. Staff updates own assigned tasks; handover acknowledgement requires a different recipient. No deletion or financial effect.',
      workUpdateInput,
    ),
  },
  '/staff/events/{bookingId}/work-items/{itemId}/history': {
    parameters: [booking, parameter('itemId')],
    get: {
      ...op(
        'readStaffWorkHistory',
        workHistorySchema,
        'Append-only history in ascending revision, maximum 25 rows.',
      ),
      requestParams: { query: workHistoryQuery },
    },
  },

  '/management/staff-accounts': {
    get: {
      ...op(
        'listStaffAccounts',
        staffDirectorySchema,
        'Manager-only directory of active staff accounts.',
      ),
      parameters: Object.entries(staffDirectoryQuery.shape).map(([name, schema]) =>
        schema.meta({ param: { name, in: 'query' } }),
      ),
    },
    post: op(
      'provisionStaffAccount',
      provisionSchema,
      'Manager invites or explicitly reissues a Staff invitation by normalized email. New Staff authority is granted only on acceptance; existing roles/passwords remain. Single-use 72-hour token opens configured MANAGE_WEB_ORIGIN/staff-invitation. Reissue supersedes the old link; 60-second cooldown and at most 3 invitations/account/day. Same-key replay never sends again. invitation.deliveryStatus ACCEPTED means provider acceptance, not mailbox delivery; FAILED is explicit provider rejection, UNKNOWN is ambiguous. Missing email/origin fails 503 STAFF_INVITATION_NOT_CONFIGURED before account creation. No token returned.',
      provisionInput,
      '201',
      { email: 'staff@example.test' },
    ),
  },
  '/management/staff-accounts/{accountId}/operational-access': {
    parameters: [parameter('accountId')],
    post: op(
      'setStaffOperationalAccess',
      operationalSchema,
      'Manager. Disabling removes only STAFF role, revokes current sessions, pending invitations and active assignments atomically; independent Couple role/access remains. Restore by issuing a new email invitation; enabled:true returns 422 STAFF_INVITATION_REQUIRED.',
      operationalInput,
      '201',
      { enabled: false, reason: 'Kết thúc nhiệm vụ vận hành' },
    ),
  },
  '/management/events/{bookingId}/assignments': {
    parameters: [booking],
    get: op(
      'listEventStaffAssignments',
      z.array(assignmentSchema).max(100),
      'Manager. Complete bounded list, at most 100 retained assignments per event.',
    ),
    post: op(
      'assignEventStaff',
      assignmentSchema,
      'Manager. expectedRevision 0 for first assignment; exact current revision for reactivation. ACTIVE account with STAFF role or a currently valid pending Staff invitation required. Pending invitees can be assigned but cannot act as Staff before accepting.',
      assignmentInput,
      '201',
      { staffAccountId: '10000000-0000-4000-8000-000000000001', expectedRevision: 0 },
    ),
  },
  '/management/events/{bookingId}/assignments/{assignmentId}/revocation': {
    parameters: [booking, parameter('assignmentId')],
    post: op(
      'revokeEventStaffAssignment',
      assignmentSchema,
      'Manager. Append retained revocation history with reason. Stale expectedRevision returns 409 STAFF_ASSIGNMENT_STALE.',
      revokeInput,
      '201',
      { expectedRevision: 1, reason: 'Thu hồi phân công sự kiện' },
    ),
  },
  '/bookings/{bookingId}/check-in-settings': {
    parameters: [booking],
    get: op('readCheckInSettings', settingsSchema, 'Owning FULL Couple or Manager; NONE default.'),
    patch: op(
      'configureCheckIn',
      settingsSchema,
      'Owning FULL Couple or Manager on a confirmed event. Enabling requires active names. Guest imports never enable. After first record, including later UNDO, mode is locked. Conflicts: NAMED_GUEST_LIST_REQUIRED, CHECK_IN_MODE_LOCKED, CHECK_IN_CONFIGURATION_STALE.',
      configurationInput,
      '200',
      { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
    ),
  },
  '/bookings/{bookingId}/attendance-summary': {
    parameters: [booking],
    get: op(
      'readAttendanceSummary',
      attendanceSchema,
      'Owning FULL Couple or Manager. NONE -> NOT_RECORDED/null; BY_GUEST_NAME -> LISTED_GUESTS_ONLY/count including retained archived Guest records. No event attendance rate or billing dependency.',
    ),
  },
  '/staff/events/{bookingId}/guests/search': {
    parameters: [booking],
    get: {
      ...op(
        'searchStaffEventGuests',
        searchSchema,
        `${operationDescription} Normalized name/phone matching; only phoneLast4, no private notes. Duplicate names remain separate IDs. Opaque cursor becomes stale on Guest changes. Seating ABSENT succeeds.`,
      ),
      requestParams: { query: searchInput },
    },
  },
  [guestPath + '/check-ins']: {
    parameters: [booking, guest],
    post: op(
      'checkInNamedGuest',
      recordSchema,
      `${operationDescription} Active Guest required. Duplicate new key -> GUEST_ALREADY_CHECKED_IN. Future eventTime rejected. First Group snapshot retained across archival/moves/UNDO/recheck-in.`,
      checkInInput,
      '201',
      {},
    ),
    get: {
      ...op(
        'readNamedGuestCheckInHistory',
        historySchema,
        `${operationDescription} Includes archived Guest history; Staff within window and Manager may read retained history after event.`,
      ),
      requestParams: { query: pageInput },
    },
  },
  [guestPath + '/check-in-undos']: {
    parameters: [booking, guest],
    post: op(
      'undoNamedGuestCheckIn',
      recordSchema,
      `${operationDescription} Staff may undo only their own effective record. Manager may undo any. expectedLedgerRevision is the effective CHECK_IN record revision for that Guest. Stale/already-undone -> CHECK_IN_CORRECTION_CONFLICT.`,
      undoInput,
      '201',
      {
        checkInRecordId: '10000000-0000-4000-8000-000000000001',
        expectedLedgerRevision: 1,
        reason: 'Sửa thao tác check-in nhầm',
      },
    ),
  },
};
