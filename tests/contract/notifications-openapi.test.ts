import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
describe('SPEC-09 strict backend hand-off', () => {
  it('publishes eleven private operations, bounded inbox and explicit encrypted delivery', () => {
    const doc = createOpenApiDocument(),
      ops = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
        [item?.get, item?.post, item?.patch, item?.delete]
          .filter((op) => op?.tags?.includes('Notifications and automation'))
          .map((op) => ({ path, op: op! })),
      );
    expect(ops).toHaveLength(11);
    for (const { op } of ops) {
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(op.description).toContain('no-store');
      if (op.requestBody) {
        expect(op.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
        expect(JSON.stringify(op.requestBody)).toContain('"additionalProperties":false');
      }
    }
    expect(doc.paths?.['/notifications/inbox']?.get?.parameters).toHaveLength(2);
    const delivery =
      doc.paths?.['/bookings/{bookingId}/guests/{guestId}/invitation-deliveries']?.post;
    expect(JSON.stringify(delivery?.requestBody)).toContain('intendedEmail');
    expect(JSON.stringify(delivery?.responses)).not.toContain('wgc_');
    for (const { path, op } of ops)
      if (!path.includes('/recipients'))
        expect(JSON.stringify(op.requestBody ?? {})).not.toMatch(
          /"(?:accountId|role|householdId|companionCount)"/u,
        );
  });
});
