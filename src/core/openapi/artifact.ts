import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const OPENAPI_ARTIFACT_PATH = resolve(PROJECT_ROOT, 'openapi', 'openapi.json');
export const OPENAPI_DIGEST_PATH = resolve(PROJECT_ROOT, 'openapi', 'openapi.sha256');
