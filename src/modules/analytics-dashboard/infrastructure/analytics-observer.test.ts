import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAnalyticsObserver } from './analytics-observer.js';
import type { AnalyticsObservation } from '../application/analytics-observation.js';

const config = {
  runtime: {
    environment: 'test' as const,
    logLevel: 'info' as const,
    port: 3001,
    restaurantTimeZone: 'Asia/Ho_Chi_Minh' as const,
  },
};
describe('PERF-10 opt-in Analytics logging', () => {
  it('is disabled by default and rejects ambiguous operator flag values', () => {
    expect(createAnalyticsObserver(config, {})).toBeUndefined();
    expect(
      createAnalyticsObserver(config, { ANALYTICS_DIAGNOSTICS_ENABLED: 'false' }),
    ).toBeUndefined();
    for (const value of ['TRUE', '1', 'yes', ''])
      expect(() =>
        createAnalyticsObserver(config, { ANALYTICS_DIAGNOSTICS_ENABLED: value }),
      ).toThrow('ANALYTICS_DIAGNOSTICS_ENABLED');
  });
  it('uses the existing redacting logger without serializing tokens or private payloads', () => {
    const records: Record<string, unknown>[] = [];
    const observer = createAnalyticsObserver(
      config,
      { ANALYTICS_DIAGNOSTICS_ENABLED: 'true' },
      {
        write(line: string) {
          records.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    );
    observer!({
      event: 'analytics_query_decision',
      entryPoint: 'http',
      requestId: randomUUID(),
      scopeDigest: 'a'.repeat(64),
      report: 'revenue',
      path: 'warm',
      reason: null,
      generationId: randomUUID(),
      token: 'private-access-token',
      body: { email: 'private@example.test' },
    } as AnalyticsObservation);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: 'analytics_query_decision',
      entryPoint: 'http',
      path: 'warm',
      level: 'info',
    });
    expect(JSON.stringify(records)).not.toContain('private-access-token');
    expect(JSON.stringify(records)).not.toContain('private@example.test');
  });
});
