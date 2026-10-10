import { execFileSync } from 'node:child_process';
import { config } from '../src/config/config.js';
import { createRuntimeFeatureManifest } from '../src/config/runtime-manifest.js';

try {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const dirty =
    execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim() !== '';
  console.log(
    JSON.stringify({ ...createRuntimeFeatureManifest(config, revision), dirty }, null, 2),
  );
} catch {
  console.error('Runtime manifest failed. Configuration values are not printed.');
  process.exitCode = 1;
}
