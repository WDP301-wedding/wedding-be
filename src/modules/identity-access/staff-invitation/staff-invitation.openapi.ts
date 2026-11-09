import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  staffInvitationDetailsInput,
  staffInvitationAcceptInput,
  staffInvitationDetailsSchema,
  staffInvitationAcceptedSchema,
} from './staff-invitation.schemas.js';

export const staffInvitationOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> =
  Object.fromEntries(
    (
      [
        [
          '/auth/staff-invitation-details',
          'getStaffInvitationDetails',
          staffInvitationDetailsInput,
          staffInvitationDetailsSchema,
        ],
        [
          '/auth/staff-invitation-acceptances',
          'acceptStaffInvitation',
          staffInvitationAcceptInput,
          staffInvitationAcceptedSchema,
        ],
      ] as const
    ).map(([path, operationId, input, output]) => [
      path,
      {
        post: {
          operationId,
          tags: ['Identity'],
          security: [],
          description:
            'Public single-use Staff invitation. Token in JSON body, never URL/query. Private no-store. Details do not consume the link. Acceptance initializes a missing password or verifies the existing password unchanged, grants STAFF only, then requires login. Revoked, superseded, consumed and expired links are rejected. 10 requests / 15 minutes per IP, shared Redis when configured.',
          requestBody: { required: true, content: { 'application/json': { schema: input } } },
          responses: {
            '200': {
              description: 'Invitation result; no session or token returned.',
              content: {
                'application/json': { schema: z.strictObject({ data: output as z.ZodType }) },
              },
            },
            '422': { $ref: '#/components/responses/UnprocessableEntity' },
            '429': { $ref: '#/components/responses/TooManyRequests' },
          },
        },
      },
    ]),
  );
