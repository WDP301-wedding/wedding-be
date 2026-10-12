import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  result,
  page,
  preferencesBody,
  preferencesDto,
  installationBody,
  installationDto,
  revisionBody,
  registryBody,
  registryDto,
  statusDto,
  requeueBody,
  inboxDto,
  readAllBody,
  guestDeliveryBody,
  guestDeliveryDto,
  id,
  listQuery,
  managementQuery,
} from './notification.schemas.js';
type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
const op = (
  operationId: string,
  schema: z.ZodType,
  body?: z.ZodType,
  created = false,
  scope = 'Own Manager/Couple account; Staff-only and Guest/public capabilities are denied.',
): Operation => ({
  operationId,
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  description:
    scope +
    ' Private no-store result. Delivery/read state is never booking approval, settlement or attendance evidence.',
  ...(body
    ? {
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: { required: true, content: { 'application/json': { schema: body } } },
      }
    : {}),
  responses: {
    [created ? '201' : '200']: {
      description: 'Redacted private result.',
      content: { 'application/json': { schema: result(schema) } },
    },
    '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { $ref: '#/components/responses/Conflict' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
    '503': {
      description:
        'Required database, credential encryption or worker configuration is unavailable.',
    },
  },
});
const param = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const own = '/notifications',
  management = '/management/notifications';
const manager =
  'Current Manager only. No destination, credential, token, provider payload or message content is returned.';
export const notificationOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  [own + '/preferences']: {
    get: op('getNotificationPreferences', preferencesDto),
    patch: op('updateNotificationPreferences', preferencesDto, preferencesBody),
  },
  [own + '/android-installations']: {
    get: op('listAndroidNotificationInstallations', z.array(installationDto)),
    post: op(
      'registerAndroidNotificationInstallation',
      installationDto,
      installationBody,
      true,
      'Active authorized Android session only; maximum five active installations. Registration is implemented; Android push delivery awaits the client/provider.',
    ),
  },
  [own + '/android-installations/{id}']: {
    parameters: [param('id')],
    delete: op('revokeAndroidNotificationInstallation', installationDto, revisionBody),
  },
  [management + '/recipient']: {
    get: op(
      'getOperationalNotificationRecipient',
      registryDto.nullable(),
      undefined,
      false,
      manager,
    ),
    patch: op(
      'configureOperationalNotificationRecipient',
      registryDto,
      registryBody,
      false,
      manager +
        ' Configures the requesting Manager account only; explicit recipient consent and purposes are audited.',
    ),
  },
  [management]: {
    get: {
      ...op('listNotificationDeliveryStatus', page(statusDto), undefined, false, manager),
      requestParams: { query: managementQuery },
    },
  },
  [management + '/{id}/requeue']: {
    parameters: [param('id')],
    post: op(
      'requeueNotificationIntent',
      statusDto,
      requeueBody,
      false,
      manager +
        ' DEAD_LETTER only; reason and expectedRevision required. Same intent UUID, a fresh six-attempt budget and unchanged immutable source. UNKNOWN cannot be blindly resent; purged credentials require an owner-issued successor.',
    ),
  },
  [own + '/inbox']: {
    get: { ...op('listNotificationInbox', page(inboxDto)), requestParams: { query: listQuery } },
  },
  [own + '/unread-count']: {
    get: op('countUnreadNotifications', z.strictObject({ count: z.int().nonnegative() })),
  },
  [own + '/inbox/{id}/read']: {
    parameters: [param('id')],
    post: op(
      'readNotification',
      z.strictObject({ id, revision: z.int().positive(), readAt: z.iso.datetime() }),
      revisionBody,
    ),
  },
  [own + '/inbox/read-all']: {
    post: op(
      'readAllNotifications',
      z.strictObject({ count: z.int().nonnegative(), throughCreatedAt: z.iso.datetime() }),
      readAllBody,
    ),
  },
  '/bookings/{bookingId}/guests/{guestId}/delivery': {
    parameters: [param('bookingId'), param('guestId')],
    post: op(
      'queuePersonalizedGuestInvitation',
      guestDeliveryDto,
      guestDeliveryBody,
      true,
      'Manager or owning FULL Couple under Guest authority. Explicit intendedEmail is required, never inferred from Guest names/phones. Receipt has identifiers only; transient credential is retained encrypted in the shared transaction and purged by expiry/terminal policy. Generic workflows need no Guest or recipient.',
    ),
  },
};
