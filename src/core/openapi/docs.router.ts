import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import express, { Router } from 'express';

import { OPENAPI_ARTIFACT_PATH } from './artifact.js';
import type { OpenApiDocument } from './generate.js';
import type { OpenApiRouterOptions } from './openapi.router.js';

const require = createRequire(import.meta.url);
const swaggerDirectory = dirname(require.resolve('swagger-ui-dist/package.json'));
const fontDirectory = dirname(require.resolve('@fontsource/be-vietnam-pro/package.json'));

const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wedding API — Tài liệu API</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/docs/fonts/400.css">
  <link rel="stylesheet" href="/docs/fonts/600.css">
  <link rel="stylesheet" href="/docs/fonts/700.css">
  <link rel="stylesheet" href="/docs/swagger-ui.css">
  <link rel="stylesheet" href="/docs/docs.css">
  <script defer src="/docs/swagger-ui-bundle.js"></script>
  <script defer src="/docs/initializer.js"></script>
</head>
<body>
  <header class="docs-intro">
    <h1>Tài liệu API</h1>
    <p>Try it out gọi API thật trên môi trường hiện tại. Trên production, thao tác tạo, sửa hoặc xóa có hiệu lực trên dữ liệu thật.</p>
    <p>Endpoint cần đăng nhập vẫn yêu cầu token và quyền phù hợp. Dùng Authorize để nhập access token; cookie đăng nhập được trình duyệt gửi tự động.</p>
    <a href="/api/v1/openapi.json">Tải OpenAPI gốc</a>
  </header>
  <div id="swagger-ui"></div>
</body>
</html>`;

const initializer = `window.ui = SwaggerUIBundle({
  url: '/docs/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  filter: true,
  displayRequestDuration: true,
  tryItOutEnabled: true,
  supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'],
  withCredentials: true,
  persistAuthorization: false,
  queryConfigEnabled: false,
  validatorUrl: null,
  presets: [SwaggerUIBundle.presets.apis],
  layout: 'BaseLayout'
});`;

const css = `:root { --font-sans: 'Be Vietnam Pro', sans-serif; }
body { margin: 0; background: #fafafa; }
body, .swagger-ui, .swagger-ui * { font-family: var(--font-sans) !important; letter-spacing: normal !important; text-transform: none !important; }
.docs-intro { max-width: 1460px; box-sizing: border-box; margin: auto; padding: 24px 20px; color: #24382c; }
.docs-intro h1 { margin: 0 0 12px; font-size: 28px; }
.docs-intro p { line-height: 1.65; }
.docs-intro a { color: #24573d; }
.swagger-ui .info { margin: 24px 0; }
@media (max-width: 600px) { .docs-intro { padding: 20px 12px; } .docs-intro h1 { font-size: 24px; } .swagger-ui .responses-inner { overflow-x: auto; } }`;

export function createDocsRouter(options: OpenApiRouterOptions = {}): Router {
  const router = Router();
  const artifactPath = options.artifactPath ?? OPENAPI_ARTIFACT_PATH;

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/', (_request, response) => response.type('html').send(html));
  router.get('/initializer.js', (_request, response) => response.type('js').send(initializer));
  router.get('/docs.css', (_request, response) => response.type('css').send(css));
  for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js']) {
    router.get(`/${asset}`, (_request, response) =>
      response.sendFile(join(swaggerDirectory, asset)),
    );
  }
  router.use('/fonts', express.static(fontDirectory, { index: false, dotfiles: 'deny' }));
  router.get('/openapi.json', async (_request, response) => {
    const document = JSON.parse(await readFile(artifactPath, 'utf8')) as OpenApiDocument;
    // The canonical client contract omits /api/v1 and includes root-level health routes.
    // Adapt only the browser document so every operation targets this backend origin.
    response.json({
      ...document,
      servers: [{ url: '/', description: 'Backend hiện tại — gọi API thật' }],
      paths: Object.fromEntries(
        Object.entries(document.paths ?? {}).map(([path, operation]) => [
          path.startsWith('/health/') ? path : `/api/v1${path}`,
          operation,
        ]),
      ),
    });
  });
  return router;
}
