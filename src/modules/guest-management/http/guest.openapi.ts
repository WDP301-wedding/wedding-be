import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  groupWriteSchema,
  groupPatchSchema,
  guestWriteSchema,
  guestPatchSchema,
  planWriteSchema,
  importPreviewSchema,
  importCommitSchema,
  linkIssueSchema,
} from '../domain/guest-policy.js';
import { listQuerySchema } from '../application/guest-readers.js';
import {
  groupSchema,
  guestSchema,
  planSchema,
  previewSchema,
  importResultSchema,
  privateListSchema,
  issuedLinkSchema,
  invitationMetadataSchema,
  exchangeBodySchema,
  sessionSchema,
  invitationViewSchema,
  responseSchema,
} from './guest.schemas.js';

type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
const parameter = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
});
const operation = (
  operationId: string,
  schema: z.ZodType,
  body?: z.ZodType,
  example?: unknown,
  created = false,
): Operation => ({
  operationId,
  tags: ['Guest management'],
  security: [{ bearerAuth: [] }],
  description:
    'Confirmed Booking: Manager or owning FULL Couple. Guest lists are optional. Writes require Idempotency-Key; list changes never derive planning, enable check-in or affect money. Cross-booking identities are concealed. Import takes parsed CSV/JSON rows; no formula/unknown columns. Companion quantities remain outside this contract.',
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
    [created ? '201' : '200']: {
      description: 'Private result; Cache-Control: no-store.',
      content: { 'application/json': { schema: responseSchema(schema) } },
    },
    '400': { $ref: '#/components/responses/IdempotencyKeyRequired' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '404': { $ref: '#/components/responses/NotFound' },
    '409': { $ref: '#/components/responses/Conflict' },
    '413': { description: 'Request exceeds configured body/import limits.' },
    '422': { $ref: '#/components/responses/UnprocessableEntity' },
  },
});
const booking = parameter('bookingId');
export const guestOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = {
  '/bookings/{bookingId}/guest-groups': {
    parameters: [booking],
    get: operation('listGuestGroups', z.array(groupSchema)),
    post: operation(
      'createGuestGroup',
      groupSchema,
      groupWriteSchema,
      { name: 'Bạn bè', color: '#059669' },
      true,
    ),
  },
  '/bookings/{bookingId}/guest-groups/{groupId}': {
    parameters: [booking, parameter('groupId')],
    patch: operation('updateGuestGroup', groupSchema, groupPatchSchema, {
      expectedRevision: 1,
      name: 'Bạn bè công ty',
    }),
  },
  '/bookings/{bookingId}/guests': {
    parameters: [booking],
    get: {
      ...operation('listNamedGuests', privateListSchema),
      requestParams: { query: listQuerySchema },
    },
    post: operation(
      'createNamedGuest',
      guestSchema,
      guestWriteSchema,
      { name: 'Nguyễn An', guestGroupId: '10000000-0000-4000-8000-000000000001' },
      true,
    ),
  },
  '/bookings/{bookingId}/guests/{guestId}': {
    parameters: [booking, parameter('guestId')],
    patch: operation('updateNamedGuest', guestSchema, guestPatchSchema, {
      expectedRevision: 1,
      status: 'ARCHIVED',
    }),
  },
  '/bookings/{bookingId}/guests/import-previews': {
    parameters: [booking],
    post: operation('previewNamedGuestImport', previewSchema, importPreviewSchema, {
      rows: [
        {
          externalRowKey: 'row-1',
          name: 'Nguyễn An',
          guestGroupId: '10000000-0000-4000-8000-000000000001',
        },
      ],
      allowUpdates: false,
    }),
  },
  '/bookings/{bookingId}/guests/imports': {
    parameters: [booking],
    post: operation('commitNamedGuestImport', importResultSchema, importCommitSchema),
  },
  '/bookings/{bookingId}/guest-plan': {
    parameters: [booking],
    get: {
      ...operation('readExplicitGuestPlan', planSchema),
      description:
        'Names-free example: planningHeadcount=300 with listedGuestCount=0; partial-list example: the same 300 with 20 named Guests. Initialization preserves Booking total. Actual attendance is unknown when check-in is NONE.',
    },
    patch: operation('reviseExplicitGuestPlan', planSchema, planWriteSchema, {
      expectedRevision: 1,
      planningHeadcount: 250,
    }),
  },
  '/bookings/{bookingId}/guests/{guestId}/personalized-invitations': {
    parameters: [booking, parameter('guestId')],
    get: {
      ...operation('readGuestInvitationMetadata', invitationMetadataSchema),
      requestParams: { query: z.strictObject({}) },
      description:
        'Manager or owning FULL Couple on a confirmed Booking. Latest credential metadata only, including expired/revoked credentials and archived Guests; revision is zero with nullable metadata before first issuance. Use revision as expectedRevision when issuing/delivering. Does not issue, revoke or recover raw credentials. Unknown query keys are rejected; foreign Guests are concealed as 404.',
    },
    post: {
      ...operation(
        'issueReadOnlyGuestInvitation',
        issuedLinkSchema,
        linkIssueSchema,
        { expectedRevision: 0 },
        true,
      ),
      description:
        'Requires active Guest and published Invitation. Raw credential returned once only, in URL fragment. Retried issuance cannot replay a raw token; use a new key/current revision to reissue. No automatic delivery or attendance write.',
    },
  },
  '/guest/invitation-sessions': {
    post: {
      ...operation('exchangeGuestInvitationCredential', sessionSchema, exchangeBodySchema),
      parameters: [],
      security: [],
      description:
        'Strict credential exchange; anonymous 10 attempts/15 minutes per resolved IP and IP/token fingerprint. Hash-only credentials/capabilities. Generic INVITATION_LINK_UNAVAILABLE on invalid/revoked/expired links.',
      responses: {
        ...operation('exchange', sessionSchema).responses,
        '429': { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },
  '/guest/invitation': {
    get: {
      ...operation('viewGuestInvitation', invitationViewSchema),
      security: [{ guestInvitationCapability: [] }],
      description:
        'Bearer wgs_ capability valid at most 15 minutes. Current approved public Invitation and recipient greeting only; no private media, groups/list, contacts, notes, planning, billing or attendance writes.',
    },
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;
