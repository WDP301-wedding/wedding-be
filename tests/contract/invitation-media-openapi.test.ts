import { describe, expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';

describe('Mounted SPEC-05 private media HTTP contract', () => {
  it('publishes the five mounted operations and their strict schemas', () => {
    const paths = createOpenApiDocument().paths!;
    const upload = paths['/bookings/{bookingId}/media']!.post!;
    const item = paths['/bookings/{bookingId}/media/{assetId}']!;
    const cutoff = paths['/management/bookings/{bookingId}/media-policy']!.patch!;
    expect(upload.operationId).toBe('uploadWeddingMedia');
    expect(item.get!.operationId).toBe('getWeddingMediaOriginal');
    expect(item.patch!.operationId).toBe('updateWeddingMedia');
    expect(item.delete!.operationId).toBe('detachWeddingMedia');
    expect(cutoff.operationId).toBe('changeWeddingMediaCutoff');
    expect(upload.requestBody).toHaveProperty('content.multipart/form-data');
    expect(item.patch!.requestBody).toHaveProperty('content.application/json');
    expect(item.patch!.requestBody).toHaveProperty('content.multipart/form-data');
    for (const op of [upload, item.get!, item.patch!, item.delete!, cutoff]) {
      expect(op.security).toEqual([{ bearerAuth: [] }]);
      expect(op.responses).toHaveProperty('503');
      expect(op.responses).toHaveProperty('409');
    }
    expect(upload.parameters).toContainEqual({ $ref: '#/components/parameters/IdempotencyKey' });
    expect(item.get!.parameters).not.toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
  });
  it('exposes safe asset IDs and private previews without internal storage/history fields', () => {
    const schemas = createOpenApiDocument().components!.schemas!;
    const serialized = JSON.stringify(schemas['WeddingMediaAssetResponse']);
    expect(serialized).toContain('mediaAssetId');
    expect(serialized).toContain('previewPath');
    expect(serialized).not.toMatch(/currentFileRevisionId|objectKey|uploadAttemptId|accessToken/u);
    expect(JSON.stringify(schemas['WeddingMediaPreviewResponse'])).toContain('900');
  });
});
