import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../assets/invitation-print');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(root, 'current.json'));
const manifest = JSON.parse(manifestBytes);
const lock = JSON.parse(await readFile(resolve(root, 'source.lock.json'), 'utf8'));
if (
  manifest.version !== 1 ||
  !/^[a-f0-9]{64}$/.test(manifest.digest) ||
  !/^[a-f0-9]{40}$/.test(lock.source.commit) ||
  lock.source.repository !== 'https://github.com/WDP301-wedding/wedding-web' ||
  lock.manifestSha256 !== hash(manifestBytes)
)
  throw Error('Invalid canonical Content renderer source lock');
const js = await readFile(resolve(root, manifest.digest, 'renderer.cjs'));
const css = await readFile(resolve(root, manifest.digest, 'renderer.css'));
if (
  hash(js) !== manifest.files['renderer.cjs'] ||
  hash(css) !== manifest.files['renderer.css'] ||
  createHash('sha256').update(js).update(css).digest('hex') !== manifest.digest
)
  throw Error('Retained Content renderer checksum mismatch');
const pkg = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'));
if (
  pkg.dependencies['playwright-core'] !== lock.runtime.playwrightCore ||
  pkg.dependencies['pdf-lib'] !== lock.runtime.pdfLib
)
  throw Error('Retained renderer runtime requires an explicit version-preserving upgrade');
console.log(
  `Canonical invitation Content renderer verified: ${manifest.digest} from ${lock.source.commit}`,
);
