import type { ZodOpenApiObject } from 'zod-openapi';
import {
  coupleProfileResponseSchema,
  profileWriteSchema,
} from '../application/couple-profile.service.js';

const responses = {
  '200': {
    description: 'Current consultation profile; legacy names may be null.',
    content: { 'application/json': { schema: coupleProfileResponseSchema } },
  },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
};
export const coupleProfileOpenApiPaths = {
  '/consultations/{consultationId}/couple-profile': {
    parameters: [
      {
        name: 'consultationId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    get: {
      operationId: 'readCoupleProfile',
      tags: ['Booking lifecycle'],
      security: [{ bearerAuth: [] }],
      description:
        'Owning Manager or account with consultation access. Cross-scope and Staff reads are concealed as 404.',
      responses,
    },
    patch: {
      operationId: 'updateCoupleProfile',
      tags: ['Booking lifecycle'],
      security: [{ bearerAuth: [] }],
      description:
        'Owning Manager or prospect/Couple with consultation access; partial name update, expected consultation revision and atomic audit. Names are trimmed NFC. Display label is retained. Does not alter approved document snapshots.',
      parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: profileWriteSchema,
            example: { expectedRevision: 1, brideName: 'Lan', groomName: 'Minh' },
          },
        },
      },
      responses,
    },
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;
