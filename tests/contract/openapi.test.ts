import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { NotFoundError } from '../../src/core/errors/app-error.js';
import { errorResponseSchema } from '../../src/core/http/common.schemas.js';
import {
  healthLiveResponseSchema,
  healthReadyResponseSchema,
} from '../../src/core/http/health.schemas.js';
import { OPENAPI_ARTIFACT_PATH, OPENAPI_DIGEST_PATH } from '../../src/core/openapi/artifact.js';
import {
  createOpenApiDocument,
  checkOpenApiArtifact,
  serializeOpenApiDocument,
  sha256,
} from '../../src/core/openapi/generate.js';

describe('OpenAPI contract', () => {
  it('generates the committed OpenAPI 3.1 artifact byte-for-byte deterministically', async () => {
    const first = serializeOpenApiDocument(createOpenApiDocument());
    const second = serializeOpenApiDocument(createOpenApiDocument());
    const committed = await readFile(resolve(OPENAPI_ARTIFACT_PATH), 'utf8');

    expect(first).toBe(second);
    expect(first).toBe(committed);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('documents health routes and the shared HTTP contract components', () => {
    const document = createOpenApiDocument();

    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty('/health/live.get.responses.200');
    expect(document.paths).toHaveProperty('/health/ready.get.responses.200');
    expect(document.paths).toHaveProperty('/health/ready.get.responses.503');
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'ErrorResponse',
        'HealthLiveResponse',
        'HealthReadyResponse',
        'IdempotencyKey',
        'PaginationMetadata',
        'RequestId',
      ]),
    );
    expect(document.components?.parameters?.IdempotencyKey).toMatchObject({
      in: 'header',
      required: true,
    });
    expect(document.components?.parameters?.RequestId).toMatchObject({
      in: 'header',
      required: false,
    });
    expect(Object.keys(document.components?.headers ?? {})).toEqual(
      expect.arrayContaining(['RequestId', 'RetryAfter']),
    );
    expect(Object.keys(document.components?.responses ?? {})).toEqual(
      expect.arrayContaining([
        'BadRequest',
        'Conflict',
        'InternalServerError',
        'InvalidIdempotencyKey',
        'IdempotencyKeyRequired',
        'IdempotencyKeyReused',
        'RequestInProgress',
        'UnprocessableEntity',
      ]),
    );
  });

  it('documents the IA-08 Web and Android session transports and retry semantics', () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};

    expect(paths).toHaveProperty('/auth/web-sessions.post.responses.201');
    expect(paths).toHaveProperty('/auth/android-sessions.post.responses.201');
    expect(paths).toHaveProperty('/auth/web-session-refreshes.post.responses.200');
    expect(paths).toHaveProperty('/auth/android-session-refreshes.post.responses.200');
    expect(paths).toHaveProperty('/auth/sessions/current.delete.responses.204');
    expect(paths).toHaveProperty('/auth/me.get.responses.200');
    expect(paths).toHaveProperty('/auth/sessions.get.responses.200');
    expect(paths).toHaveProperty('/auth/sessions/{sessionId}.delete.responses.204');
    expect(document.components?.parameters?.WebRefreshCookie).toMatchObject({
      in: 'cookie',
      name: '__Host-wedding-refresh',
      required: true,
    });
    expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(paths['/auth/sessions/current']?.delete?.description).toContain('Idempotent');
    expect(paths['/auth/web-session-refreshes']?.post?.description).toContain('Unsafe to replay');
  });

  it('documents IA-13 reset and invitation credentials only in POST request bodies', () => {
    const document = createOpenApiDocument();
    const paths = document.paths ?? {};

    expect(paths).toHaveProperty('/auth/password-reset-requests.post.responses.202');
    expect(paths).toHaveProperty('/auth/password-reset-completions.post.responses.200');
    expect(paths).toHaveProperty('/workspace-invitation-acceptances.post.responses.201');
    expect(paths['/auth/password-reset-completions']?.post?.requestBody).toBeDefined();
    expect(paths['/workspace-invitation-acceptances']?.post?.requestBody).toBeDefined();
    expect(JSON.stringify(paths)).not.toMatch(
      /"in":"(?:query|path|header)"[^}]*"name":"(?:resetToken|invitationToken)"/u,
    );
  });

  it('publishes the exact SHA-256 digest of the committed immutable artifact', async () => {
    const [artifact, digest] = await Promise.all([
      readFile(resolve(OPENAPI_ARTIFACT_PATH), 'utf8'),
      readFile(resolve(OPENAPI_DIGEST_PATH), 'utf8'),
    ]);

    expect(digest).toBe(`${sha256(artifact)}\n`);
  });

  it('rejects a committed artifact that has drifted from the registered schemas', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wedding-openapi-test-'));
    const driftedArtifact = join(temporaryDirectory, 'openapi.json');

    try {
      await Promise.all([
        writeFile(driftedArtifact, '{}\n', 'utf8'),
        writeFile(`${driftedArtifact}.sha256`, `${'0'.repeat(64)}\n`, 'utf8'),
      ]);

      await expect(checkOpenApiArtifact(driftedArtifact)).rejects.toThrow(
        'The committed OpenAPI artifact has drifted.',
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a stale digest even when the custom artifact bytes are current', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wedding-openapi-digest-test-'));
    const artifact = join(temporaryDirectory, 'openapi.json');
    const serialized = serializeOpenApiDocument(createOpenApiDocument());

    try {
      await Promise.all([
        writeFile(artifact, serialized, 'utf8'),
        writeFile(`${artifact}.sha256`, `${'0'.repeat(64)}\n`, 'utf8'),
      ]);

      await expect(checkOpenApiArtifact(artifact)).rejects.toThrow(
        'The committed OpenAPI artifact has drifted.',
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('keeps documented health and error examples valid against the runtime schemas', async () => {
    const document = createOpenApiDocument();
    const app = createApp({
      registerRoutes: (expressApp) => {
        expressApp.get('/forced-error', () => {
          throw new NotFoundError();
        });
      },
    });

    const [live, ready, notFound] = await Promise.all([
      request(app).get('/health/live'),
      request(app).get('/health/ready'),
      request(app).get('/forced-error'),
    ]);

    expect(healthLiveResponseSchema.safeParse(live.body).success).toBe(true);
    expect(healthReadyResponseSchema.safeParse(ready.body).success).toBe(true);
    expect(errorResponseSchema.safeParse(notFound.body).success).toBe(true);
    expect(
      healthLiveResponseSchema.safeParse(readResponseExample(document, '/health/live', '200'))
        .success,
    ).toBe(true);
    expect(
      healthReadyResponseSchema.safeParse(readResponseExample(document, '/health/ready', '200'))
        .success,
    ).toBe(true);
    expect(
      errorResponseSchema.safeParse(readResponseExample(document, '/health/ready', '503')).success,
    ).toBe(true);

    for (const response of Object.values(document.components?.responses ?? {})) {
      expect(errorResponseSchema.safeParse(readJsonResponseExample(response)).success).toBe(true);
    }
  });

  it('serves the exact committed artifact under the environment policy', async () => {
    const committed = await readFile(resolve(OPENAPI_ARTIFACT_PATH), 'utf8');
    const expectedDocument = JSON.parse(committed) as unknown;

    const developmentResponse = await request(createApp({ runtimeEnvironment: 'development' })).get(
      '/api/v1/openapi.json',
    );
    const productionDisabledResponse = await request(
      createApp({ runtimeEnvironment: 'production' }),
    ).get('/api/v1/openapi.json');
    const productionEnabledResponse = await request(
      createApp({ enableOpenApiInProduction: true, runtimeEnvironment: 'production' }),
    ).get('/api/v1/openapi.json');

    expect(developmentResponse.status).toBe(200);
    expect(developmentResponse.text).toBe(committed);
    expect(developmentResponse.body).toEqual(expectedDocument);
    expect(productionDisabledResponse.status).toBe(404);
    expect(productionEnabledResponse.status).toBe(200);
    expect(productionEnabledResponse.text).toBe(committed);
    expect(productionEnabledResponse.body).toEqual(expectedDocument);
  });

  it('returns the standard error contract when the configured artifact is unavailable', async () => {
    const response = await request(
      createApp({
        openApiArtifactPath: resolve('openapi', 'missing-openapi.json'),
        reportUnexpectedError: () => undefined,
      }),
    ).get('/api/v1/openapi.json');

    expect(response.status).toBe(500);
    expect(errorResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });
});

function readResponseExample(
  document: unknown,
  path: '/health/live' | '/health/ready',
  status: '200' | '503',
): unknown {
  const paths = asRecord(asRecord(document).paths);
  const operation = asRecord(asRecord(paths[path]).get);
  const responses = asRecord(operation.responses);

  return readJsonResponseExample(responses[status]);
}

function readJsonResponseExample(response: unknown): unknown {
  const responseObject = asRecord(response);

  if ('$ref' in responseObject) {
    throw new Error('Expected an inline OpenAPI response with an example.');
  }

  const content = asRecord(responseObject.content);
  return asRecord(content['application/json']).example;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an OpenAPI object.');
  }

  return value as Record<string, unknown>;
}
