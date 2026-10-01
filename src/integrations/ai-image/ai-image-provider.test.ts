import { describe, expect, it, vi } from 'vitest';

import { ProviderError, ValidationError } from '../../core/errors/app-error.js';
import {
  AiImageInvalidOutputError,
  AiImageProviderDisabledError,
  AiImageSafetyRefusalError,
  type GenerateAiImageCommand,
} from './ai-image-provider.js';
import { DisabledAiImageProvider, FakeAiImageProvider } from './fake-ai-image-provider.js';
import {
  createGeminiAiImageProvider,
  GeminiAiImageProvider,
  type GeminiAiImageClientLike,
} from './gemini-ai-image-provider.js';

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl1Z7sAAAAASUVORK5CYII=';

function validCommand(): GenerateAiImageCommand {
  return {
    aspectRatio: '1:1',
    prompt: 'An elegant watercolor arrangement of ivory flowers and eucalyptus leaves.',
  };
}

function successResponse(data = pngBase64, mimeType = 'image/png'): unknown {
  return {
    candidates: [
      {
        content: { parts: [{ inlineData: { data, mimeType } }], role: 'model' },
        finishReason: 'STOP',
      },
    ],
  };
}

function createClient(generateContent: (request: unknown) => Promise<unknown>) {
  const generateContentMock = vi.fn(generateContent);
  const client: GeminiAiImageClientLike = {
    models: { generateContent: generateContentMock },
  };
  return { client, generateContentMock };
}

function createAdapter(
  client: GeminiAiImageClientLike,
  options: { readonly maxOutputBytes?: number; readonly timeoutMs?: number } = {},
): GeminiAiImageProvider {
  return new GeminiAiImageProvider({
    client,
    model: 'gemini-image-model',
    timeoutMs: options.timeoutMs ?? 50,
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
  });
}

describe('AI image command boundary', () => {
  it('rejects unknown fields and unsupported aspect ratios before generation', async () => {
    const provider = new FakeAiImageProvider();
    const unknownField = {
      ...validCommand(),
      guestEmail: 'guest@example.com',
    } as unknown as GenerateAiImageCommand;
    const unsupportedRatio = {
      ...validCommand(),
      aspectRatio: '10:1',
    } as unknown as GenerateAiImageCommand;

    await expect(provider.generate(unknownField)).rejects.toBeInstanceOf(ValidationError);
    await expect(provider.generate(unsupportedRatio)).rejects.toBeInstanceOf(ValidationError);
    expect(provider.generationCount).toBe(0);
  });

  it.each([
    'Add guest@example.com to the corner.',
    'Include the phone number +84 912 345 678.',
    'Print card 4111 1111 1111 1111 on the invitation.',
    'Use Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature.',
    'Use booking id 11111111-1111-4111-8111-111111111111.',
  ])(
    'rejects prompts containing contact, payment, auth, or entity identifiers: %s',
    async (prompt) => {
      const provider = new FakeAiImageProvider();

      await expect(provider.generate({ ...validCommand(), prompt })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(provider.generationCount).toBe(0);
    },
  );
});

describe('FakeAiImageProvider', () => {
  it('generates a deterministic validated PNG entirely offline', async () => {
    const provider = new FakeAiImageProvider();

    const first = await provider.generate(validCommand());
    const second = await provider.generate(validCommand());

    expect(first).toMatchObject({
      contentType: 'image/png',
      height: 1,
      sizeBytes: Buffer.from(pngBase64, 'base64').byteLength,
      width: 1,
    });
    expect(Buffer.from(first.bytes)).toEqual(Buffer.from(pngBase64, 'base64'));
    expect(second).toEqual(first);
    expect(provider.generationCount).toBe(2);
  });

  it('fails closed without network access when the provider is disabled', async () => {
    const provider = new DisabledAiImageProvider();

    const promise = provider.generate(validCommand());

    await expect(promise).rejects.toBeInstanceOf(AiImageProviderDisabledError);
    await expect(promise).rejects.toMatchObject({ code: 'AI_IMAGE_PROVIDER_DISABLED' });
  });
});

describe('GeminiAiImageProvider', () => {
  it('requests one image with no tools and accepts a validated PNG response', async () => {
    const { client, generateContentMock } = createClient(() => Promise.resolve(successResponse()));
    const provider = createAdapter(client);

    const result = await provider.generate(validCommand());

    expect(result).toMatchObject({
      contentType: 'image/png',
      height: 1,
      sizeBytes: Buffer.from(pngBase64, 'base64').byteLength,
      width: 1,
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const capturedRequest = generateContentMock.mock.calls[0]?.[0] as {
      readonly config: { readonly abortSignal: AbortSignal };
    } & Record<string, unknown>;
    expect(capturedRequest).toMatchObject({
      config: {
        candidateCount: 1,
        httpOptions: { retryOptions: { attempts: 1 }, timeout: 50 },
        imageConfig: { aspectRatio: '1:1' },
        responseModalities: ['IMAGE'],
      },
      contents: validCommand().prompt,
      model: 'gemini-image-model',
    });
    expect(capturedRequest.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(capturedRequest).not.toHaveProperty('tools');
  });

  it.each([
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'IMAGE_SAFETY' }] },
    { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] },
    { candidates: [{ finishReason: 'SPII' }] },
  ])('maps a safety refusal to a stable error without raw provider detail', async (response) => {
    const { client } = createClient(() => Promise.resolve(response));

    const promise = createAdapter(client).generate(validCommand());

    await expect(promise).rejects.toBeInstanceOf(AiImageSafetyRefusalError);
    await expect(promise).rejects.toMatchObject({ code: 'AI_IMAGE_SAFETY_REFUSAL' });
    await expect(promise).rejects.not.toHaveProperty('cause');
  });

  it.each([
    ['malformed response', { ok: true }],
    ['missing image', { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }],
    [
      'multiple images',
      {
        candidates: [
          {
            content: {
              parts: [
                { inlineData: { data: pngBase64, mimeType: 'image/png' } },
                { inlineData: { data: pngBase64, mimeType: 'image/png' } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ],
    ['unsupported MIME', successResponse(pngBase64, 'image/jpeg')],
    ['invalid base64', successResponse('not-base64!')],
    ['MIME-signature mismatch', successResponse(Buffer.from('not a png').toString('base64'))],
  ])('rejects %s as untrusted provider output', async (_caseName, response) => {
    const { client } = createClient(() => Promise.resolve(response));

    const promise = createAdapter(client).generate(validCommand());

    await expect(promise).rejects.toBeInstanceOf(AiImageInvalidOutputError);
    await expect(promise).rejects.toMatchObject({ code: 'AI_IMAGE_INVALID_OUTPUT' });
    await expect(promise).rejects.not.toHaveProperty('cause');
  });

  it('enforces configured byte and hard dimension caps on decoded image output', async () => {
    const pngBytes = Buffer.from(pngBase64, 'base64');
    const oversizedDimensions = Buffer.from(pngBytes);
    oversizedDimensions.writeUInt32BE(4097, 16);

    const byteLimited = createAdapter(
      createClient(() => Promise.resolve(successResponse())).client,
      { maxOutputBytes: pngBytes.byteLength - 1 },
    );
    const dimensionLimited = createAdapter(
      createClient(() => Promise.resolve(successResponse(oversizedDimensions.toString('base64'))))
        .client,
    );

    await expect(byteLimited.generate(validCommand())).rejects.toBeInstanceOf(
      AiImageInvalidOutputError,
    );
    await expect(dimensionLimited.generate(validCommand())).rejects.toBeInstanceOf(
      AiImageInvalidOutputError,
    );
  });

  it('times out and aborts a provider call without exposing the raw operation', async () => {
    let capturedSignal: AbortSignal | undefined;
    const { client } = createClient((request) => {
      capturedSignal = (request as { readonly config: { readonly abortSignal: AbortSignal } })
        .config.abortSignal;
      return new Promise<never>(() => undefined);
    });

    const promise = createAdapter(client, { timeoutMs: 5 }).generate(validCommand());

    await expect(promise).rejects.toBeInstanceOf(ProviderError);
    await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('normalizes quota and transient failures as unavailable', async () => {
    for (const rejection of [
      Object.assign(new Error('quota detail'), { status: 429 }),
      Object.assign(new Error('service detail'), { status: 503 }),
    ]) {
      const { client } = createClient(() => Promise.reject(rejection));
      const promise = createAdapter(client).generate(validCommand());

      await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      await expect(promise).rejects.not.toHaveProperty('cause');
    }
  });

  it('normalizes permanent and opaque failures without leaking SDK errors', async () => {
    for (const rejection of [
      Object.assign(new Error('bad request detail'), { status: 400 }),
      new Error('opaque provider detail'),
    ]) {
      const { client } = createClient(() => Promise.reject(rejection));
      const promise = createAdapter(client).generate(validCommand());

      await expect(promise).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      await expect(promise).rejects.not.toHaveProperty('cause');
    }
  });

  it('rejects unsafe adapter configuration before invoking the client', () => {
    const { client, generateContentMock } = createClient(() => Promise.resolve(successResponse()));

    expect(() => new GeminiAiImageProvider({ client, model: '   ' })).toThrow(TypeError);
    expect(
      () => new GeminiAiImageProvider({ client, model: 'gemini-image-model', timeoutMs: 0 }),
    ).toThrow(TypeError);
    expect(
      () =>
        new GeminiAiImageProvider({
          client,
          maxOutputBytes: 0,
          model: 'gemini-image-model',
        }),
    ).toThrow(TypeError);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('constructs the official SDK adapter without issuing a request', () => {
    const provider = createGeminiAiImageProvider({
      apiKey: 'test-api-key',
      model: 'gemini-image-model',
      timeoutMs: 25,
    });

    expect(provider).toBeInstanceOf(GeminiAiImageProvider);
  });
});
