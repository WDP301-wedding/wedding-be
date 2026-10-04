import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('IA-12 identity-owned provider boundary', () => {
  it('has no reverse source dependency on booking or payment modules', async () => {
    const sourceFiles = await collectTypeScriptFiles(resolve('src', 'modules', 'identity-access'));
    const sources = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')));

    expect(sources.join('\n')).not.toMatch(/\b(?:booking-lifecycle|payments-billing)\b/u);
  });
});

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? collectTypeScriptFiles(path)
        : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}
