import {
  AiImageProviderDisabledError,
  createGeneratedAiImage,
  validateGenerateAiImageCommand,
  type AiImageProvider,
  type GenerateAiImageCommand,
  type GeneratedAiImage,
} from './ai-image-provider.js';

const fakePngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl1Z7sAAAAASUVORK5CYII=',
  'base64',
);

export class FakeAiImageProvider implements AiImageProvider {
  #generationCount = 0;

  get generationCount(): number {
    return this.#generationCount;
  }

  generate(command: GenerateAiImageCommand): Promise<GeneratedAiImage> {
    return Promise.resolve().then(() => {
      validateGenerateAiImageCommand(command);
      const image = createGeneratedAiImage(fakePngBytes, 'image/png');
      this.#generationCount += 1;
      return image;
    });
  }
}

export class DisabledAiImageProvider implements AiImageProvider {
  generate(command: GenerateAiImageCommand): Promise<GeneratedAiImage> {
    return Promise.resolve().then(() => {
      validateGenerateAiImageCommand(command);
      throw new AiImageProviderDisabledError();
    });
  }
}
