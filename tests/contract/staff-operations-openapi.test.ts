import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
describe('SPEC-08 exact private backend contract', () => {
  it('publishes all twelve operations with strict named-Guest inputs and retry/auth contracts', () => {
    const doc = createOpenApiDocument();
    const operations = Object.entries(doc.paths ?? {}).flatMap(([path, value]) =>
      [value?.get, value?.post, value?.patch]
        .filter((op) => op?.tags?.includes('Staff operations'))
        .map((op) => ({ path, op: op! })),
    );
    expect(operations).toHaveLength(12);
    for (const { op } of operations) {
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      const input = JSON.stringify(op.requestBody ?? {});
      expect(input).not.toMatch(
        /"(?:householdId|invitationHouseholdId|actualAttendees|role|password|companionCount)"/u,
      );
      if (op.requestBody) {
        expect(op.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
        expect(input).toContain('"additionalProperties":false');
      }
    }
    const search = doc.paths?.['/staff/events/{bookingId}/guests/search']?.get;
    expect(search?.parameters?.length).toBe(3);
  });
});
