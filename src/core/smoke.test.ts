import { describe, expect, it } from 'vitest';

describe('backend test harness', () => {
  it('loads the ESM entry point', async () => {
    const backendEntry = await import('../index.js');

    expect(backendEntry).toBeTypeOf('object');
  });

  it('runs tests in the Node environment', () => {
    expect(process.release.name).toBe('node');
    expect('window' in globalThis).toBe(false);
  });
});
