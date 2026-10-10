import { z } from 'zod';
import type { ZodOpenApiObject, ZodOpenApiOperationObject } from 'zod-openapi';
import {
  createServiceSchema,
  reviseServiceSchema,
  serviceViewSchema,
  createPrintOfferingSchema,
  revisePrintOfferingSchema,
  printOfferingViewSchema,
} from '../domain/commercial-offering.js';

const id = {
  name: 'id',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};
const page = [
  { name: 'cursor', in: 'query' as const, schema: { type: 'string' as const, format: 'uuid' } },
  {
    name: 'limit',
    in: 'query' as const,
    schema: { type: 'integer' as const, minimum: 1, maximum: 50, default: 20 },
  },
];
function operation(
  operationId: string,
  schema: z.ZodType,
  options: {
    body?: z.ZodType;
    status?: number;
    parameters?: ZodOpenApiOperationObject['parameters'];
    description: string;
  },
): ZodOpenApiOperationObject {
  return {
    operationId,
    tags: ['Venue commercial catalog'],
    security: [{ bearerAuth: [] }],
    description: options.description,
    ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
    ...(options.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: options.body } },
          },
        }),
    responses: {
      [options.status ?? 200]: {
        description: 'Commercial catalog facts, never design/media content.',
        content: { 'application/json': { schema } },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '404': { $ref: '#/components/responses/NotFound' },
      '409': { $ref: '#/components/responses/Conflict' },
      '422': { $ref: '#/components/responses/UnprocessableEntity' },
    },
  };
}
function paths(
  kind: string,
  prefix: string,
  create: z.ZodType,
  revise: z.ZodType,
  view: z.ZodType,
): NonNullable<ZodOpenApiObject['paths']> {
  const result = z.strictObject({ data: view });
  const list = z.strictObject({
    data: z.strictObject({ items: z.array(view), nextCursor: z.uuid().nullable() }),
  });
  return {
    ['/catalog/' + kind]: {
      get: operation('listSelectable' + prefix, list, {
        parameters: page,
        description:
          'Authenticated prospect, Couple or Manager. Active current offerings only; print template must also be active and current. Staff-only accounts denied. Page may be empty after template filtering; follow nextCursor.',
      }),
    },
    ['/management/' + kind]: {
      get: operation('listManaged' + prefix, list, {
        parameters: page,
        description: 'Manager catalog, including archived heads.',
      }),
      post: operation('create' + prefix, result, {
        body: create,
        status: 201,
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        description:
          'Manager creates revision 1 with server-owned restaurant identity and audit. No client totals.',
      }),
    },
    ['/management/' + kind + '/{id}']: {
      patch: operation('revise' + prefix, result, {
        body: revise,
        parameters: [id, { $ref: '#/components/parameters/IdempotencyKey' }],
        description:
          'Manager supplies all replacement display/price facts and expectedRevision. Set active=false to archive. Immutable prior revisions survive. Stale price/revision conflicts with 409.',
      }),
    },
  };
}
export const commercialCatalogOpenApiPaths = {
  ...paths(
    'services',
    'RestaurantServices',
    createServiceSchema,
    reviseServiceSchema,
    serviceViewSchema,
  ),
  ...paths(
    'print-offerings',
    'PrintOfferings',
    createPrintOfferingSchema,
    revisePrintOfferingSchema,
    printOfferingViewSchema,
  ),
};
