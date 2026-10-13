import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  preferencesInput,
  installationInput,
  revisionInput,
  requeueInput,
  resolutionInput,
  registryInput,
  pageInput,
  operationsInput,
  deliveryInput,
} from '../domain/notification-policy.js';
import {
  preferenceSchema,
  installationSchema,
  recipientSchema,
  deliverySchema,
  readSchema,
  recoverySchema,
  inboxSchema,
  operationsSchema,
} from './notification.schemas.js';
type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
const param = (name: string) => ({
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
  post = false,
  query?: z.ZodObject,
): Operation => ({
  operationId,
  tags: ['Notifications and automation'],
  security: [{ bearerAuth: [] }],
  description: `${description} Private no-store. Strict schemas reject extra fields; current active account/session and Manager/Couple role required. Mutations require Idempotency-Key; identical replay returns the original result after authorization. No notification/read/delivery outcome changes Booking, payment, invoice or attendance authority.`,
  ...(body === undefined
    ? {}
    : {
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: { required: true, content: { 'application/json': { schema: body } } },
      }),
  ...(query === undefined ? {} : { requestParams: { query } }),
  responses: {
    [post ? '201' : '200']: {
      description: 'Authorized result.',
      content: { 'application/json': { schema: z.strictObject({ data: output }) } },
    },
    '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { $ref: '#/components/responses/Conflict' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
    '503': { $ref: '#/components/responses/ServiceUnavailable' },
  },
});
export const notificationOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/notifications/preferences': {
    get: op(
      'getNotificationPreferences',
      preferenceSchema,
      'Own preferences. Defaults true/true at revision 0. Transactional credentials/payments are never muted.',
    ),
    patch: op(
      'setNotificationPreferences',
      preferenceSchema,
      'Own informational/reminder email/push settings with expected revision.',
      preferencesInput,
    ),
  },
  '/notifications/android-installations': {
    post: op(
      'registerNotificationAndroidInstallation',
      installationSchema,
      'Current Android session only. Max five active installations; superseded token encrypted and replaced. Push dispatch rechecks logout/revocation. Never returns a token.',
      installationInput,
      true,
    ),
  },
  '/notifications/android-installations/{id}': {
    parameters: [param('id')],
    delete: op(
      'revokeNotificationAndroidInstallation',
      installationSchema,
      'Own installation only; cross-account returns 404. Revocation clears ciphertext.',
      revisionInput,
    ),
  },
  '/notifications/inbox': {
    get: op(
      'listNotificationInbox',
      inboxSchema,
      'Own recipient inbox, current booking scope, 90-day display window; one entry per source email intent even if optional delivery muted. Target screen/booking ID is navigation metadata; frontend resolves authorized screen.',
      undefined,
      false,
      pageInput,
    ),
  },
  '/notifications/inbox/{id}/read': {
    parameters: [param('id')],
    patch: op(
      'markNotificationRead',
      readSchema,
      'Own inbox only. Read timestamp set once; replay does not approve any domain action.',
      revisionInput,
    ),
  },
  '/management/notifications': {
    get: op(
      'listNotificationOperations',
      operationsSchema,
      'Manager. Redacted operational metadata only; no address, token, ciphertext, raw message or provider payload.',
      undefined,
      false,
      operationsInput,
    ),
  },
  '/management/notifications/{id}/requeue': {
    parameters: [param('id')],
    post: op(
      'requeueNotificationIntent',
      recoverySchema,
      'Manager, audited reason. Only retryable/dead-letter intent below six total attempts; UNKNOWN requires evidence resolution first. Same identity/key, no blind resend; expired/purged Guest secret ineligible.',
      requeueInput,
      true,
    ),
  },
  '/management/notifications/{id}/resolve': {
    parameters: [param('id')],
    post: op(
      'resolveUnknownNotification',
      recoverySchema,
      'Manager UNKNOWN resolution with reason and non-secret evidence reference. DELIVERED freezes outcome; NOT_SENT enables same-intent retry. Immutable attempt evidence retained.',
      resolutionInput,
      true,
    ),
  },
  '/management/notifications/bookings/{bookingId}/recipients': {
    parameters: [param('bookingId')],
    post: op(
      'configureNotificationManagerRecipient',
      recipientSchema,
      'Manager explicitly configures an active Manager account for this booking and OPERATIONS/FINANCE/PRINT. No inferred or developer recipient.',
      registryInput,
      true,
    ),
  },
  '/bookings/{bookingId}/guests/{guestId}/invitation-deliveries': {
    parameters: [param('bookingId'), param('guestId')],
    post: op(
      'sendGuestInvitation',
      deliverySchema,
      'Owning FULL Couple/Manager, confirmed settled booking, active Guest and published invitation. Explicit email; atomically issues Guest credential and enqueues encrypted delivery. Plaintext never returned or stored in events/history. Ciphertext expires at token expiry or 72h, whichever comes first. No named list/contact required for generic invitation.',
      deliveryInput,
      true,
    ),
  },
};
