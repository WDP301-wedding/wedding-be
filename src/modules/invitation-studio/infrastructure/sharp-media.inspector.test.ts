import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../core/errors/app-error.js';
import { MEDIA_LIMITS } from '../domain/media-policy.js';
import { SharpMediaInspector } from './sharp-media.inspector.js';

describe('SPEC-05 complete local image decoder', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes a complete real %s payload',
    async (format) => {
      const bytes = await sharp({
        create: { width: 8, height: 9, channels: 3, background: '#abcdef' },
      })
        .toFormat(format)
        .toBuffer();
      expect(await new SharpMediaInspector().inspect(bytes, MEDIA_LIMITS)).toEqual({
        contentType: `image/${format}`,
        width: 8,
        height: 9,
      });
    },
  );

  it.each(['png', 'jpeg', 'webp'] as const)(
    'rejects truncated %s after a parseable header',
    async (format) => {
      const bytes = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#abcdef' },
      })
        .toFormat(format)
        .toBuffer();
      await expect(
        new SharpMediaInspector().inspect(bytes.subarray(0, bytes.length - 20), MEDIA_LIMITS),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it('rejects header-valid PNG with corrupt compressed pixel data', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 9, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer();
    const index = bytes.indexOf(Buffer.from('IDAT'));
    bytes.fill(0, index + 4, index + 10);
    await expect(new SharpMediaInspector().inspect(bytes, MEDIA_LIMITS)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects GIF/SVG/arbitrary bytes instead of accepting formats supported by libvips', async () => {
    const inspector = new SharpMediaInspector();
    const gif = await sharp({ create: { width: 8, height: 9, channels: 3, background: '#abcdef' } })
      .gif()
      .toBuffer();
    for (const bytes of [gif, Buffer.from('<svg width="1" height="1"></svg>'), Buffer.from('bad')])
      await expect(inspector.inspect(bytes, MEDIA_LIMITS)).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces encoded bytes and decoded dimension/pixel bounds before materialisation', async () => {
    const inspector = new SharpMediaInspector();
    const tall = await sharp({
      create: { width: 1, height: 12001, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer();
    await expect(inspector.inspect(tall, MEDIA_LIMITS)).rejects.toBeInstanceOf(ValidationError);
    const small = await sharp({
      create: { width: 8, height: 9, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer();
    await expect(
      inspector.inspect(small, { maxDimension: 12000, maxPixels: 71 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await inspector.inspect(small, { maxDimension: 12000, maxPixels: 72 })).toMatchObject({
      width: 8,
      height: 9,
    });
    for (const bytes of [new Uint8Array(), new Uint8Array(MEDIA_LIMITS.fileBytes + 1)])
      await expect(inspector.inspect(bytes, MEDIA_LIMITS)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      inspector.inspect(small, { maxDimension: 0, maxPixels: 72 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('counts every animated WebP frame against the decoded pixel budget', async () => {
    const pixels = Buffer.concat([Buffer.alloc(8 * 9 * 3, 255), Buffer.alloc(8 * 9 * 3, 0)]);
    const bytes = await sharp(pixels, { raw: { width: 8, height: 18, channels: 3, pageHeight: 9 } })
      .webp({ loop: 0, delay: [20, 20] })
      .toBuffer();
    expect((await sharp(bytes, { pages: -1 }).metadata()).pages).toBe(2);
    const inspector = new SharpMediaInspector();
    await expect(
      inspector.inspect(bytes, { maxDimension: 12000, maxPixels: 72 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await inspector.inspect(bytes, { maxDimension: 12000, maxPixels: 144 })).toMatchObject({
      width: 8,
      height: 9,
    });
  });

  it('bounds concurrent native work and releases capacity after a decoding error', async () => {
    expect(() => new SharpMediaInspector(0)).toThrow(RangeError);
    expect(() => new SharpMediaInspector(1, 0)).toThrow(RangeError);
    const inspector = new SharpMediaInspector(1);
    const first = inspector.inspect(Buffer.from('bad'), MEDIA_LIMITS);
    await expect(inspector.inspect(Buffer.from('bad'), MEDIA_LIMITS)).rejects.toMatchObject({
      code: 'MEDIA_DECODER_BUSY',
    });
    await expect(first).rejects.toBeInstanceOf(ValidationError);
    await expect(inspector.inspect(Buffer.from('bad'), MEDIA_LIMITS)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
