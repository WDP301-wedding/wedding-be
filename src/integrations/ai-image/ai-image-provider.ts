import { AppError } from '../../core/errors/app-error.js';
import {
  generateAiImageCommandSchema,
  MAX_AI_IMAGE_BYTES,
  MAX_AI_IMAGE_DIMENSION,
  MAX_AI_IMAGE_PIXELS,
  parseAiImageInput,
  type AiImageAspectRatio,
} from './ai-image.schemas.js';

const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface GenerateAiImageCommand {
  readonly aspectRatio: AiImageAspectRatio;
  readonly prompt: string;
}

export interface GeneratedAiImage {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/png';
  readonly height: number;
  readonly sizeBytes: number;
  readonly width: number;
}

export interface AiImageProvider {
  generate(command: GenerateAiImageCommand): Promise<GeneratedAiImage>;
}

export class AiImageSafetyRefusalError extends AppError {
  constructor() {
    super({
      status: 422,
      code: 'AI_IMAGE_SAFETY_REFUSAL',
      message: 'The image request was refused by the provider safety system.',
    });
  }
}

export class AiImageInvalidOutputError extends AppError {
  constructor() {
    super({
      status: 502,
      code: 'AI_IMAGE_INVALID_OUTPUT',
      message: 'The image provider returned invalid output.',
    });
  }
}

export class AiImageProviderDisabledError extends AppError {
  constructor() {
    super({
      status: 503,
      code: 'AI_IMAGE_PROVIDER_DISABLED',
      message: 'AI image generation is disabled.',
    });
  }
}

export function validateGenerateAiImageCommand(
  command: GenerateAiImageCommand,
): GenerateAiImageCommand {
  const validated = parseAiImageInput(generateAiImageCommandSchema, command);
  return Object.freeze({
    aspectRatio: validated.aspectRatio,
    prompt: validated.prompt,
  });
}

export function createGeneratedAiImage(
  bytes: Uint8Array,
  contentType: string,
  maxOutputBytes = MAX_AI_IMAGE_BYTES,
): GeneratedAiImage {
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > MAX_AI_IMAGE_BYTES
  ) {
    throw new TypeError(`AI image byte cap must be between 1 and ${MAX_AI_IMAGE_BYTES}.`);
  }
  if (contentType !== 'image/png' || bytes.byteLength === 0 || bytes.byteLength > maxOutputBytes) {
    throw new AiImageInvalidOutputError();
  }

  const dimensions = readPngDimensions(bytes);
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_AI_IMAGE_DIMENSION ||
    dimensions.height > MAX_AI_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_AI_IMAGE_PIXELS
  ) {
    throw new AiImageInvalidOutputError();
  }

  const safeBytes = Uint8Array.from(bytes);
  return Object.freeze({
    bytes: safeBytes,
    contentType: 'image/png' as const,
    height: dimensions.height,
    sizeBytes: safeBytes.byteLength,
    width: dimensions.width,
  });
}

function readPngDimensions(bytes: Uint8Array): { readonly height: number; readonly width: number } {
  if (bytes.byteLength < 24 || !startsWith(bytes, pngSignature)) {
    throw new AiImageInvalidOutputError();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    throw new AiImageInvalidOutputError();
  }

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
