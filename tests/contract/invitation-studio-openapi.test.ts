import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
describe('SPEC-05 W2/W3 implemented external schemas', () => {
  it('publishes private editor/generation/publication and public projection/render/PNG operations', () => {
    const document = createOpenApiDocument(),
      paths = document.paths!;
    for (const path of [
      '/invitation-templates',
      '/management/invitation-templates',
      '/management/invitation-templates/{templateId}',
      '/bookings/{bookingId}/invitations',
      '/bookings/{bookingId}/invitations/{designId}',
      '/bookings/{bookingId}/invitations/{designId}/revisions',
      '/bookings/{bookingId}/invitations/{designId}/publication',
      '/bookings/{bookingId}/invitation-image-generations',
      '/bookings/{bookingId}/invitation-image-generations/{intentDigest}/reconciliation',
      '/bookings/{bookingId}/invitation-derived-assets',
    ])
      expect(paths[path]).toBeDefined();
    expect(paths['/bookings/{bookingId}/invitation-image-generations']!.get!.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(
      paths['/bookings/{bookingId}/invitations/{designId}/publication']!.delete!.parameters,
    ).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
    for (const path of [
      '/public/invitations/{slug}',
      '/public/invitations/{slug}/render',
      '/public/invitations/{slug}/qr',
      '/public/invitation-assets/{slug}',
    ])
      expect(paths[path]!.get!.security).toEqual([]);
    const schema = document.components!.schemas!['PublicWeddingInvitation'];
    const publicDto = JSON.stringify(schema);
    expect(publicDto).toContain('genericQrPayload');
    expect(schema).toHaveProperty(
      'properties.data.properties.seating.anyOf.0.items',
      expect.objectContaining({
        additionalProperties: false,
        required: [
          'tableLabel',
          'shape',
          'x',
          'y',
          'width',
          'height',
          'rotationDegrees',
          'guestGroupName',
          'color',
        ],
      }),
    );
    expect(publicDto).not.toMatch(
      /bookingId|derivedAssetIds|objectKey|signedUrl|guestGroupId|guestId|guestName|email|phone|billing|accessToken/u,
    );
    expect(paths['/public/invitations/{slug}/qr']!.get!.responses!['200']).toHaveProperty(
      'content.image/png',
    );
  });
});
