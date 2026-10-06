import { describe, expect, it } from 'vitest';

import { createOpenApiDocument } from '../../src/core/openapi/generate.js';

describe('FT-V3 immutable venue catalog contract', () => {
  it('publishes every public and manager catalog operation with stable operation IDs', () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};

    expect(paths).toHaveProperty('/catalog/restaurant.get.operationId', 'getPublicRestaurant');
    expect(paths).toHaveProperty('/catalog/halls.get.operationId', 'listPublicHalls');
    expect(paths).toHaveProperty('/catalog/dishes.get.operationId', 'listPublicDishes');
    expect(paths).toHaveProperty(
      '/catalog/menu-packages.get.operationId',
      'listPublicMenuPackages',
    );
    expect(paths).toHaveProperty('/management/catalog/dishes.post.operationId', 'createDishDraft');
    expect(paths).toHaveProperty(
      '/management/catalog/restaurant.get.operationId',
      'getManagerRestaurant',
    );
    expect(paths).toHaveProperty('/management/catalog/shifts.get.operationId', 'listManagerShifts');
    expect(paths).toHaveProperty('/management/catalog/halls.get.operationId', 'listManagerHalls');
    expect(paths).toHaveProperty(
      '/management/catalog/timeline-template-versions/{versionId}/publication.post.operationId',
      'publishTimelineTemplateVersion',
    );
    expect(paths).toHaveProperty(
      '/management/catalog/layout-template-versions/{versionId}/publication.post.operationId',
      'publishLayoutTemplateVersion',
    );
    expect(paths).toHaveProperty(
      '/management/catalog/media-assets.post.requestBody.content.multipart/form-data',
    );
    expect(paths).toHaveProperty(
      '/management/catalog/{resource}/{resourceId}/media.get.operationId',
      'listCatalogMedia',
    );
  });

  it('contains no public/Couple geometry mutation or storage and actor internals', () => {
    const serialized = JSON.stringify(createOpenApiDocument());

    expect(serialized).not.toMatch(/objectKey|createdByAccountId|updatedByAccountId/iu);
    expect(serialized).not.toMatch(/couple.*(?:geometry|layout).*mutation/iu);
    const paths = Object.keys(createOpenApiDocument().paths ?? {});
    expect(paths).not.toContain('/catalog/layout-templates');
    expect(paths).not.toContain('/catalog/timeline-templates');
  });
});
