import sharp from 'sharp';

import { AppError, ValidationError } from '../../../core/errors/app-error.js';
import type { StorageContentType } from '../../../integrations/storage/storage.schemas.js';
import type { MediaImageInspector } from '../application/media.contracts.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';

/** Complete local decoding, no re-encoding or remote processing of originals.
 * A shared instance bounds decode memory instead of queuing arbitrary uploads. */
export class SharpMediaInspector implements MediaImageInspector {
  #active = 0;
  constructor(
    readonly maxConcurrentDecodes = 2,
    readonly timeoutSeconds = 10,
  ) {
    if (
      !Number.isInteger(maxConcurrentDecodes) ||
      maxConcurrentDecodes < 1 ||
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < 1
    )
      throw new RangeError('Invalid decoder configuration.');
  }

  async inspect(
    bytes: Uint8Array,
    limits: { readonly maxDimension: number; readonly maxPixels: number },
  ) {
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > MEDIA_LIMITS.fileBytes ||
      !Number.isInteger(limits.maxDimension) ||
      limits.maxDimension < 1 ||
      !Number.isInteger(limits.maxPixels) ||
      limits.maxPixels < 1
    )
      throw new ValidationError();
    if (this.#active >= this.maxConcurrentDecodes) {
      throw new AppError({
        status: 503,
        code: 'MEDIA_DECODER_BUSY',
        message: 'Image validation is busy. Retry the same command later.',
      });
    }
    this.#active++;
    try {
      const image = sharp(Buffer.from(bytes), {
        failOn: 'warning',
        limitInputPixels: limits.maxPixels,
        limitInputChannels: 4,
        pages: -1,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      const contentType = mime(metadata.format);
      const width = metadata.width,
        height = metadata.pageHeight ?? metadata.height;
      const pages = metadata.pages ?? 1;
      if (
        !width ||
        !height ||
        width > limits.maxDimension ||
        height > limits.maxDimension ||
        !Number.isSafeInteger(pages) ||
        pages < 1 ||
        width * height * pages > limits.maxPixels
      )
        throw new ValidationError();
      // metadata() reads only headers. Materialise every frame to validate compressed
      // pixels/truncation before accepting. uchar caps output to <=4 bytes/pixel.
      const decoded = await image
        .timeout({ seconds: this.timeoutSeconds })
        .raw({ depth: 'uchar' })
        .toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== width ||
        decoded.info.height !== height * pages ||
        decoded.data.byteLength > limits.maxPixels * 4
      )
        throw new ValidationError();
      return { contentType, width, height };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      // Native decoder messages can contain untrusted image metadata. Never expose
      // or attach these messages as causes to the HTTP/logging boundary.
      throw new ValidationError();
    } finally {
      this.#active--;
    }
  }
}

function mime(format: string | undefined): StorageContentType {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      throw new ValidationError();
  }
}
