import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('co-hosted MongoDB image and startup contract', () => {
  it('keeps the paid instance and existing disk while binding MongoDB to loopback only', async () => {
    const [docker, blueprint, startup, runtime] = await Promise.all([
      readFile('Dockerfile', 'utf8'),
      readFile('render.yaml', 'utf8'),
      readFile('scripts/render-start.sh', 'utf8'),
      readFile('src/integrations/storage/embedded-mongo.cli.ts', 'utf8'),
    ]);
    expect(docker).toContain('mongodb-org-server=8.0.34');
    expect(docker).toContain('USER node');
    expect(blueprint).toContain('plan: 1c-2g');
    expect(blueprint).toContain('mountPath: /var/data');
    expect(blueprint).not.toContain('type: pserv');
    expect(startup).toContain('CATALOG_MONGO_EMBEDDED_ENABLED');
    expect(startup).toContain(
      'exec node --enable-source-maps dist/integrations/storage/embedded-mongo.cli.js',
    );
    expect(runtime).toContain("'127.0.0.1'");
    expect(runtime).toContain("'--auth'");
    expect(runtime).not.toContain("'--bind_ip_all'");
  });
});
