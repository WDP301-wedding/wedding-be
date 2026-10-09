import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
import type { OpenApiDocument } from '../../src/core/openapi/generate.js';

describe('Swagger documentation', () => {
  it('serves the UI, assets, and browser spec only when the OpenAPI environment policy allows it', async () => {
    for (const path of [
      '/docs',
      '/docs/',
      '/docs/initializer.js',
      '/docs/openapi.json',
      '/docs/swagger-ui-bundle.js',
    ]) {
      const disabled = await request(createApp({ runtimeEnvironment: 'production' })).get(path);
      const enabled = await request(
        createApp({ runtimeEnvironment: 'production', enableOpenApiInProduction: true }),
      ).get(path);
      expect(disabled.status).toBe(404);
      expect(enabled.status).toBe(200);
      expect(enabled.headers['cache-control']).toBe('no-store');
    }
    const html = await request(createApp()).get('/docs');
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('dữ liệu thật');
    expect(html.text).toContain('/docs/initializer.js');
    expect(html.headers['content-security-policy']).toContain("script-src 'self'");
    expect(html.text).not.toContain('<script>');
  });

  it('serves Vietnamese fonts locally and does not serve the distribution demo page', async () => {
    const app = createApp();
    const fontCss = await request(app).get('/docs/fonts/400.css');
    expect(fontCss.status).toBe(200);
    expect(fontCss.text).toContain('Be Vietnam Pro');
    const font = await request(app).get(
      '/docs/fonts/files/be-vietnam-pro-vietnamese-400-normal.woff2',
    );
    expect(font.status).toBe(200);
    expect((await request(app).get('/docs/index.html')).status).toBe(404);
  });

  it('targets real API routes on this origin while preserving the canonical client artifact', async () => {
    const app = createApp();
    const browserSpec = await request(app).get('/docs/openapi.json');
    const document = browserSpec.body as OpenApiDocument;
    const canonical = createOpenApiDocument();
    const canonicalResponse = await request(app).get('/api/v1/openapi.json');
    expect(canonicalResponse.body).toEqual(canonical);
    expect(document.servers).toEqual([
      { url: '/', description: 'Backend hiện tại — gọi API thật' },
    ]);
    expect(document.components).toEqual(canonical.components);
    expect(Object.keys(document.paths ?? {})).toHaveLength(
      Object.keys(canonical.paths ?? {}).length,
    );
    for (const [path, operation] of Object.entries(canonical.paths ?? {})) {
      const target = path.startsWith('/health/') ? path : `/api/v1${path}`;
      expect(document.paths?.[target]).toEqual(operation);
    }
    expect(document.paths).toHaveProperty('/api/v1/catalog/halls');
    expect(document.paths).toHaveProperty('/health/live');
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it('reports a missing artifact through the standard error contract', async () => {
    const response = await request(
      createApp({ openApiArtifactPath: 'missing.json', reportUnexpectedError: () => undefined }),
    ).get('/docs/openapi.json');
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});
