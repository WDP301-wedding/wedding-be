import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDocument } from 'zod-openapi';

import { OPENAPI_ARTIFACT_PATH, OPENAPI_DIGEST_PATH } from './artifact.js';
import { openApiRegistry } from './registry.js';
import { isRetiredGuestPath } from '../http/retired-guest-operations.js';

export type OpenApiDocument = ReturnType<typeof createDocument>;

export function createOpenApiDocument(): OpenApiDocument {
  const document = createDocument(openApiRegistry);
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!isRetiredGuestPath(path)) continue;
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      operation.deprecated = true;
      delete operation.requestBody;
      // Retirement only needs authentication; former bodies/command keys are ignored.
      delete operation.parameters;
      operation.description =
        'Retired 2026-11-08. Authenticated requests return 410 FEATURE_RETIRED without reading or changing named guests/check-in. Use planning headcount, groups, generic invitations and assigned event operations.';
      operation.responses = {
        '401': { $ref: '#/components/responses/Unauthorized' },
        '410': {
          description:
            'FEATURE_RETIRED. Update the client; no replacement named-list/check-in operation.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['error'],
                properties: {
                  error: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['code', 'message', 'requestId'],
                    properties: {
                      code: { type: 'string', const: 'FEATURE_RETIRED' },
                      message: { type: 'string' },
                      requestId: { type: 'string', format: 'uuid' },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }
  }
  return document;
}

export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(sortJsonValue(document), undefined, 2)}\n`;
}

export async function generateOpenApiArtifact(
  artifactPath = OPENAPI_ARTIFACT_PATH,
  digestPath = artifactPath === OPENAPI_ARTIFACT_PATH
    ? OPENAPI_DIGEST_PATH
    : `${artifactPath}.sha256`,
): Promise<void> {
  const serialized = serializeOpenApiDocument(createOpenApiDocument());
  await Promise.all([
    mkdir(dirname(artifactPath), { recursive: true }),
    mkdir(dirname(digestPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(artifactPath, serialized, 'utf8'),
    writeFile(digestPath, `${sha256(serialized)}\n`, 'utf8'),
  ]);
}

export async function checkOpenApiArtifact(artifactPath = OPENAPI_ARTIFACT_PATH): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wedding-openapi-'));
  const temporaryArtifact = join(temporaryDirectory, 'openapi.json');
  const temporaryDigest = `${temporaryArtifact}.sha256`;

  try {
    await generateOpenApiArtifact(temporaryArtifact);
    const [generated, committed, generatedDigest, committedDigest] = await Promise.all([
      readFile(temporaryArtifact, 'utf8'),
      readFile(artifactPath, 'utf8'),
      readFile(temporaryDigest, 'utf8'),
      readFile(
        artifactPath === OPENAPI_ARTIFACT_PATH ? OPENAPI_DIGEST_PATH : `${artifactPath}.sha256`,
        'utf8',
      ),
    ]);

    if (generated !== committed || generatedDigest !== committedDigest) {
      throw new Error(
        'The committed OpenAPI artifact has drifted. Run `npm run api:generate` and commit the result.',
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
