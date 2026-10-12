import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { z } from 'zod';
import { AppError, ProviderError } from '../../../core/errors/app-error.js';
import { approvedTimelineSnapshotSchema } from '../../booking-lifecycle/application/booking-readers.js';
import {
  designContentSchema,
  digest,
  id,
  parseStudio,
  studioConflict,
  seatingRenderSchema,
} from '../domain/studio-policy.js';
import { renderSeating } from './seating-print.renderer.js';

export const PRINT_RENDERER_VERSION = 'invitation-a5-v1';
export const SEATING_PRINT_RENDERER_VERSION = 'invitation-a5-v2-seating';
export const PRINT_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const mm = (n: number) => (n * 72) / 25.4;
const font = (name: string) =>
  readFileSync(new URL(`../../../../assets/fonts/${name}.ttf`, import.meta.url));
const regular = font('BeVietnamPro-Regular'),
  bold = font('BeVietnamPro-SemiBold');
export const printableFileContentSchema = z
  .strictObject({
    design: designContentSchema,
    timeline: approvedTimelineSnapshotSchema,
    seating: z
      .strictObject({ seatingPlanRevisionId: id, renderSnapshot: seatingRenderSchema })
      .nullable(),
    genericQrPayload: z
      .url()
      .max(512)
      .refine((value) => /^https?:\/\//u.test(value)),
    publicInvitationId: id,
    publishedRevisionId: id,
  })
  .refine((v) => v.design.includesSeating === (v.seating !== null));
export function printLimit(code: 'PRINT_CONTENT_OVERFLOW' | 'PRINT_ASSET_LIMIT'): never {
  throw new AppError({
    status: 422,
    code,
    message: 'Content exceeds the accepted two-sided print format.',
  });
}
export async function renderPrintablePdf(input: {
  content: unknown;
  contentDigest: string;
  createdAt: Date;
  images: ReadonlyMap<string, Uint8Array>;
}) {
  if (digest(input.content) !== input.contentDigest)
    throw studioConflict('PRINTABLE_DIGEST_CONFLICT');
  const content = parseStudio(printableFileContentSchema, input.content);
  const rendererVersion =
    content.seating === null ? PRINT_RENDERER_VERSION : SEATING_PRINT_RENDERER_VERSION;
  const ids = content.design.derivedAssetIds;
  if (ids.length > 8 || input.images.size !== ids.length) printLimit('PRINT_ASSET_LIMIT');
  const images: Array<{ bytes: Buffer; width: number; height: number }> = [];
  let size = 0;
  for (const assetId of ids) {
    const bytes = input.images.get(assetId);
    if (bytes === undefined) throw new ProviderError('failure');
    size += bytes.byteLength;
    if (size > PRINT_MAX_IMAGE_BYTES) printLimit('PRINT_ASSET_LIMIT');
    try {
      const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40000000 }).timeout({
        seconds: 10,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== 'png' ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > 40000000 ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error('Invalid image');
      // Decode all pixels before PDFKit embeds the retained PNG.
      await image.raw().toBuffer();
      images.push({ bytes: Buffer.from(bytes), width: metadata.width, height: metadata.height });
    } catch {
      throw new ProviderError('failure');
    }
  }
  const pdf = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: {
      Title: content.design.title,
      CreationDate: input.createdAt,
      ModDate: input.createdAt,
      Producer: rendererVersion,
    },
  });
  pdf.registerFont('Body', regular).registerFont('Heading', bold);
  const left = mm(15),
    width = mm(124);
  let y = left,
    bottom = mm(198);
  const page = () => {
    pdf.addPage({ size: [mm(154), mm(216)], margin: 0 });
    const dictionary = pdf.page.dictionary.data as Record<string, unknown>;
    dictionary.TrimBox = [mm(3), mm(3), mm(151), mm(213)];
    dictionary.BleedBox = [0, 0, mm(154), mm(216)];
    pdf.rect(0, 0, mm(154), mm(216)).fill('#fffdf9');
    y = left;
  };
  const text = (value: string | undefined, heading = false) => {
    if (!value) return;
    pdf
      .fillColor('#342a29')
      .font(heading ? 'Heading' : 'Body')
      .fontSize(heading ? 18 : 10);
    const options = { width, lineGap: 3, align: 'center' as const };
    const height = pdf.heightOfString(value.normalize('NFC'), options);
    if (y + height > bottom) printLimit('PRINT_CONTENT_OVERFLOW');
    pdf.text(value.normalize('NFC'), left, y, options);
    y += height + mm(4);
  };
  page();
  text(content.design.title, true);
  text(content.design.textFields.greeting);
  text(content.design.textFields.brideName, true);
  text(content.design.textFields.groomName, true);
  for (const image of images) {
    const scale = Math.min(width / image.width, mm(60) / image.height, 72 / 300);
    const w = image.width * scale,
      h = image.height * scale;
    if (y + h > bottom) printLimit('PRINT_CONTENT_OVERFLOW');
    pdf.image(image.bytes, left + (width - w) / 2, y, { width: w, height: h });
    y += h + mm(4);
  }
  page();
  bottom = mm(165);
  text(content.design.textFields.message);
  text(content.timeline.hallName, true);
  text(
    `${content.timeline.eventDate} · ${content.timeline.shiftStartTime} - ${content.timeline.shiftEndTime}`,
  );
  for (const item of content.timeline.items) {
    text(`${item.startTime} · ${item.title}`);
    text(item.description ?? undefined);
  }
  text(content.design.textFields.footer);
  if (content.seating !== null)
    y = renderSeating(pdf, content.seating.renderSnapshot, { left, top: y, width, bottom });
  const qr = QRCode.create(content.genericQrPayload, { errorCorrectionLevel: 'M' });
  const qrSize = mm(30),
    cell = qrSize / (qr.modules.size + 8);
  const x = (mm(154) - qrSize) / 2,
    top = mm(172);
  pdf.rect(x, top, qrSize, qrSize).fill('#ffffff');
  pdf.fillColor('#000000');
  for (let row = 0; row < qr.modules.size; row++)
    for (let col = 0; col < qr.modules.size; col++) {
      if (qr.modules.get(row, col))
        pdf.rect(x + (col + 4) * cell, top + (row + 4) * cell, cell, cell).fill();
    }
  const chunks: Buffer[] = [];
  let outputSize = 0;
  const complete = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > MAX_PDF_BYTES) {
        pdf.destroy();
        reject(
          new AppError({
            status: 422,
            code: 'PRINT_ASSET_LIMIT',
            message: 'Print file exceeds the accepted size limit.',
          }),
        );
      } else chunks.push(chunk);
    });
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdf.end();
  const bytes = await complete;
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), rendererVersion };
}
