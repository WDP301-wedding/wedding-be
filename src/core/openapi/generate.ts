import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDocument } from 'zod-openapi';

import { OPENAPI_ARTIFACT_PATH } from './artifact.js';
import { openApiRegistry } from './registry.js';

export type OpenApiDocument = ReturnType<typeof createDocument>;

export function createOpenApiDocument(): OpenApiDocument {
  return createDocument(openApiRegistry);
}

export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(sortJsonValue(document), undefined, 2)}\n`;
}

export async function generateOpenApiArtifact(artifactPath = OPENAPI_ARTIFACT_PATH): Promise<void> {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, serializeOpenApiDocument(createOpenApiDocument()), 'utf8');
}

export async function checkOpenApiArtifact(artifactPath = OPENAPI_ARTIFACT_PATH): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wedding-openapi-'));
  const temporaryArtifact = join(temporaryDirectory, 'openapi.json');

  try {
    await generateOpenApiArtifact(temporaryArtifact);
    const [generated, committed] = await Promise.all([
      readFile(temporaryArtifact, 'utf8'),
      readFile(artifactPath, 'utf8'),
    ]);

    if (generated !== committed) {
      throw new Error(
        'The committed OpenAPI artifact has drifted. Run `npm run api:generate` and commit the result.',
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }

  return value;
}
