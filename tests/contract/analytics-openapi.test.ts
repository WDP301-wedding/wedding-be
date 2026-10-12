import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
import {
  analyticsQuerySchema,
  analyticsResultSchemas,
} from '../../src/modules/analytics-dashboard/http/analytics.schemas.js';
describe('SPEC-10 exact OpenAPI', () => {
  it('publishes five protected strict reports plus authorized rebuild with freshness and nullable measurement', () => {
    const doc = createOpenApiDocument();
    for (const report of Object.keys(analyticsResultSchemas)) {
      const op = doc.paths?.['/management/analytics/' + report]?.get;
      expect(op?.security).toEqual([{ bearerAuth: [] }]);
      expect(op?.responses?.['200']).toBeDefined();
      expect(op?.parameters?.map((p) => ('name' in p ? p.name : ''))).toContain('dateFrom');
      expect(JSON.stringify(op)).toContain('sourceCheckpoints');
    }
    expect(doc.paths?.['/management/analytics/rebuild']?.post?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(JSON.stringify(doc.paths?.['/management/analytics/attendance'])).toContain(
      'NOT_RECORDED',
    );
  });
  it('enforces dates, unknown fields, integer pagination and a 366-day limit', () => {
    expect(
      analyticsQuerySchema.safeParse({ dateFrom: '2026-01-01', dateTo: '2027-01-01' }).success,
    ).toBe(true);
    expect(
      analyticsQuerySchema.safeParse({ dateFrom: '2026-01-01', dateTo: '2027-01-02' }).success,
    ).toBe(false);
    for (const fields of [
      { dateFrom: '2026-02-30', dateTo: '2026-03-01' },
      { dateFrom: '2026-01-02', dateTo: '2026-01-01' },
      { dateFrom: '2026-10-13', dateTo: '2026-10-13', pageSize: 1.5 },
      { dateFrom: '2026-10-13', dateTo: '2026-10-13', unknown: true },
    ])
      expect(analyticsQuerySchema.safeParse(fields).success).toBe(false);
  });
});
