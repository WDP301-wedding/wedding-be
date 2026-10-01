import { GoogleGenAI } from '@google/genai';

import { AppError, ProviderError } from '../../core/errors/app-error.js';
import {
  AiImageInvalidOutputError,
  AiImageSafetyRefusalError,
  createGeneratedAiImage,
  validateGenerateAiImageCommand,
  type AiImageProvider,
  type GenerateAiImageCommand,
  type GeneratedAiImage,
} from './ai-image-provider.js';
import {
  geminiGenerateContentResponseSchema,
  geminiInlineImagePartSchema,
  MAX_AI_IMAGE_BYTES,
  type AiImageAspectRatio,
} from './ai-image.schemas.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const safetyFinishReasons = new Set([
  'BLOCKLIST',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'SAFETY',
  'SPII',
]);
const safetyBlockReasons = new Set([
  'BLOCKLIST',
  'IMAGE_SAFETY',
  'JAILBREAK',
  'MODEL_ARMOR',
  'OTHER',
  'PROHIBITED_CONTENT',
  'SAFETY',
]);

interface GeminiGenerateContentRequest {
  readonly config: {
    readonly abortSignal: AbortSignal;
    readonly candidateCount: 1;
    readonly httpOptions: {
      readonly retryOptions: { readonly attempts: 1 };
      readonly timeout: number;
    };
    readonly imageConfig: { readonly aspectRatio: AiImageAspectRatio };
    readonly responseModalities: ['IMAGE'];
  };
  readonly contents: string;
  readonly model: string;
}

export interface GeminiAiImageClientLike {
  readonly models: {
    generateContent(request: GeminiGenerateContentRequest): Promise<unknown>;
  };
}

interface GeminiAiImageProviderOptions {
  readonly client: GeminiAiImageClientLike;
  readonly maxOutputBytes?: number;
  readonly model: string;
  readonly timeoutMs?: number;
}

export interface GeminiAiImageConfiguration {
  readonly apiKey: string;
  readonly maxOutputBytes?: number;
  readonly model: string;
  readonly timeoutMs?: number;
}

export class GeminiAiImageProvider implements AiImageProvider {
  readonly #client: GeminiAiImageClientLike;
  readonly #maxOutputBytes: number;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(options: GeminiAiImageProviderOptions) {
    const model = options.model.trim();
    if (model === '' || model.length > 128 || !/^[a-z\d._/-]+$/iu.test(model)) {
      throw new TypeError('Gemini image model configuration is invalid.');
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new TypeError('Gemini timeout must be between 1 and 60000 milliseconds.');
    }

    const maxOutputBytes = options.maxOutputBytes ?? MAX_AI_IMAGE_BYTES;
    if (
      !Number.isInteger(maxOutputBytes) ||
      maxOutputBytes <= 0 ||
      maxOutputBytes > MAX_AI_IMAGE_BYTES
    ) {
      throw new TypeError(`Gemini image byte cap must be between 1 and ${MAX_AI_IMAGE_BYTES}.`);
    }

    this.#client = options.client;
    this.#maxOutputBytes = maxOutputBytes;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
  }

  async generate(command: GenerateAiImageCommand): Promise<GeneratedAiImage> {
    const validated = validateGenerateAiImageCommand(command);
    const response = await this.#invoke(validated);
    const parsed = geminiGenerateContentResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new AiImageInvalidOutputError();
    }

    const blockReason = parsed.data.promptFeedback?.blockReason;
    if (blockReason !== undefined && safetyBlockReasons.has(blockReason)) {
      throw new AiImageSafetyRefusalError();
    }

    const candidates = parsed.data.candidates;
    if (candidates?.some((candidate) => safetyFinishReasons.has(candidate.finishReason ?? ''))) {
      throw new AiImageSafetyRefusalError();
    }
    if (candidates?.length !== 1 || candidates[0]?.finishReason !== 'STOP') {
      throw new AiImageInvalidOutputError();
    }

    const parts = candidates[0].content?.parts;
    if (parts?.length !== 1) {
      throw new AiImageInvalidOutputError();
    }
    const imagePart = geminiInlineImagePartSchema.safeParse(parts[0]);
    if (!imagePart.success || imagePart.data.thought === true) {
      throw new AiImageInvalidOutputError();
    }

    const bytes = decodeBase64Image(imagePart.data.inlineData.data, this.#maxOutputBytes);
    return createGeneratedAiImage(bytes, imagePart.data.inlineData.mimeType, this.#maxOutputBytes);
  }

  async #invoke(command: GenerateAiImageCommand): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GeminiProviderTimeoutError());
      }, this.#timeoutMs);
    });

    try {
      return await Promise.race([
        this.#client.models.generateContent({
          config: {
            abortSignal: controller.signal,
            candidateCount: 1,
            httpOptions: {
              retryOptions: { attempts: 1 },
              timeout: this.#timeoutMs,
            },
            imageConfig: { aspectRatio: command.aspectRatio },
            responseModalities: ['IMAGE'],
          },
          contents: command.prompt,
          model: this.#model,
        }),
        timeout,
      ]);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      throw normalizeThrownProviderError(error);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

export function createGeminiAiImageProvider(
  configuration: GeminiAiImageConfiguration,
): GeminiAiImageProvider {
  if (configuration.apiKey.trim() === '') {
    throw new TypeError('Gemini API key configuration is invalid.');
  }

  const ai = new GoogleGenAI({ apiKey: configuration.apiKey });
  return new GeminiAiImageProvider({
    client: {
      models: {
        generateContent: (request) => ai.models.generateContent(request),
      },
    },
    model: configuration.model,
    ...(configuration.maxOutputBytes === undefined
      ? {}
      : { maxOutputBytes: configuration.maxOutputBytes }),
    ...(configuration.timeoutMs === undefined ? {} : { timeoutMs: configuration.timeoutMs }),
  });
}

function decodeBase64Image(value: string, maxOutputBytes: number): Uint8Array {
  const maximumEncodedLength = Math.ceil(maxOutputBytes / 3) * 4;
  if (
    value.length === 0 ||
    value.length > maximumEncodedLength ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value)
  ) {
    throw new AiImageInvalidOutputError();
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.byteLength > maxOutputBytes) {
    throw new AiImageInvalidOutputError();
  }
  return bytes;
}

function normalizeThrownProviderError(error: unknown): ProviderError {
  if (error instanceof GeminiProviderTimeoutError || hasErrorName(error, 'AbortError')) {
    return new ProviderError('timeout');
  }
  const status = providerStatus(error);
  return new ProviderError(
    status === 429 || (status !== undefined && status >= 500) ? 'unavailable' : 'failure',
  );
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const status = (error as { readonly status?: unknown }).status;
  if (typeof status === 'number' && Number.isInteger(status)) {
    return status;
  }
  if (typeof status === 'string' && /^\d{3}$/u.test(status)) {
    return Number(status);
  }
  return undefined;
}

function hasErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === name
  );
}

class GeminiProviderTimeoutError extends Error {}
