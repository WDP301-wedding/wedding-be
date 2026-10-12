import { z } from 'zod';
import type { ZodOpenApiObject } from 'zod-openapi';
import {
  analyticsQuerySchema,
  analyticsResultSchemas,
  rebuildBodySchema,
  projectionResultSchema,
} from './analytics.schemas.js';
type Operation = NonNullable<NonNullable<NonNullable<ZodOpenApiObject['paths']>[string]>['get']>;
function operation(operationId: string, schema: z.ZodType): Operation {
  return {
    operationId,
    tags: ['Analytics'],
    security: [{ bearerAuth: [] }],
    description:
      'Active Manager only, single-restaurant scope, no-store. Local dates are inclusive Asia/Ho_Chi_Minh; cash uses half-open UTC instants, event metrics use eventDate. Immutable source snapshots; nullable disabled check-ins are not whole-event attendance. Freshness includes individual owner fences. Lists are ordered by UUID and generation/filter-bound cursors. 409 ANALYTICS_CURSOR_STALE requires restarting pagination; 422 ANALYTICS_QUERY_TOO_BROAD enforces bounded aggregates.',
    responses: {
      '200': {
        description: 'Authoritative bounded analytics result.',
        content: { 'application/json': { schema: z.strictObject({ data: schema }) } },
        headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '403': { $ref: '#/components/responses/Forbidden' },
      '409': { $ref: '#/components/responses/Conflict' },
      '422': { $ref: '#/components/responses/UnprocessableEntity' },
      '503': { $ref: '#/components/responses/ServiceUnavailable' },
      '500': { $ref: '#/components/responses/InternalServerError' },
    },
  };
}
export const analyticsOpenApiPaths: NonNullable<ZodOpenApiObject['paths']> = Object.fromEntries(
  (Object.keys(analyticsResultSchemas) as (keyof typeof analyticsResultSchemas)[]).map((report) => [
    '/management/analytics/' + report,
    {
      get: {
        ...operation(
          'getAnalytics' + report.replace(/(^|-)(\w)/g, (_m, _p, c: string) => c.toUpperCase()),
          analyticsResultSchemas[report],
        ),
        requestParams: { query: analyticsQuerySchema },
      },
    },
  ]),
);
analyticsOpenApiPaths['/management/analytics/rebuild'] = {
  post: {
    ...operation('rebuildAnalytics', projectionResultSchema),
    requestBody: { required: true, content: { 'application/json': { schema: rebuildBodySchema } } },
  },
};
analyticsOpenApiPaths['/management/analytics/exports/overview'] = {
  get: {
    ...operation('exportAnalyticsOverview', analyticsResultSchemas.overview),
    description:
      'Manager-only bounded JSON aggregate export. Same source definitions and filters as overview; audits filters and aggregate row count without copying row content. No spreadsheet or named-Guest export.',
    requestParams: { query: analyticsQuerySchema },
  },
};
