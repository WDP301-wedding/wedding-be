import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
const dependabotPath = join(process.cwd(), '.github', 'dependabot.yml');

describe('backend CI contract', () => {
  it('gates pull requests and main pushes on every required backend check', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('push:');
    expect(workflow).toMatch(/branches:\s*\[main\]/u);
    expect(workflow).toContain("node-version-file: '.node-version'");
    expect(workflow.match(/run: npm ci/gu)).toHaveLength(2);
    expect(workflow).toContain('run: npm run format:check');
    expect(workflow).toContain('run: npm run lint');
    expect(workflow).toContain('run: npm run typecheck');
    expect(workflow).toContain('run: npm run test:unit');
    expect(workflow).toContain('run: npm run test:contract');
    expect(workflow).toContain('run: npm run test:coverage -- --maxWorkers=2');
    expect(workflow).toContain('run: npm run api:check');
    expect(workflow).toContain('run: npm run build');
    expect(workflow).toContain('run: npm run audit:ci');
    expect(workflow).toContain('image: postgres:17');
    expect(workflow).toContain(
      'TEST_MIGRATION_DATABASE_URL: postgresql://wedding_ci:wedding_ci_only@127.0.0.1:5432/wedding_ci',
    );
    expect(workflow).toContain('run: npm run db:migrate:deploy');
    expect(workflow).toContain('run: npm run test:integration');
    expect(workflow).not.toContain('continue-on-error');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).not.toContain('pull_request_target');
  });

  it('keeps monthly npm and GitHub Actions updates independent with bounded PR counts', async () => {
    const dependabot = await readFile(dependabotPath, 'utf8');

    expect(dependabot).toContain('package-ecosystem: npm');
    expect(dependabot).toContain('package-ecosystem: github-actions');
    expect(dependabot.match(/interval: monthly/gu)).toHaveLength(2);
    expect(dependabot).toMatch(/package-ecosystem: npm[\s\S]*?open-pull-requests-limit: 2/u);
    expect(dependabot).toMatch(
      /package-ecosystem: github-actions[\s\S]*?open-pull-requests-limit: 1/u,
    );
    expect(dependabot).toContain('prisma-stack:');
    expect(dependabot).toContain('vitest-stack:');
    expect(dependabot).toContain("dependency-name: '@types/node'");
  });
});
