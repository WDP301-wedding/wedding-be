import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
describe('SPEC-07 published backend contract', () => {
  it('publishes all six private actions and no geometry or person-placement inputs', () => {
    const doc = createOpenApiDocument();
    const paths = Object.entries(doc.paths ?? {}).filter(([p]) => p.includes('seating-'));
    expect(paths).toHaveLength(6);
    for (const [, path] of paths) {
      const operations = [path?.get, path?.post].filter(Boolean);
      for (const operation of operations) {
        expect(operation?.security).toEqual([{ bearerAuth: [] }]);
        const input = JSON.stringify(operation?.requestBody ?? {});
        expect(input).not.toMatch(
          /"(?:guestId|seatId|x|y|width|height|rotationDegrees|colorSnapshot)"/u,
        );
        if (operation?.requestBody) expect(operation.responses).toHaveProperty('201');
      }
    }
  });
});
