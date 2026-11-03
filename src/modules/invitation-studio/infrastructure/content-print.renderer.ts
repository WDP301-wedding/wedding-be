import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { z } from 'zod';
import QRCode from 'qrcode';
import { AppError } from '../../../core/errors/app-error.js';
import { publicSeating } from '../domain/public-invitation.js';
import type { printableFileContentSchema } from './print-file.renderer.js';

const root = new URL('../../../../assets/invitation-print/', import.meta.url);
const manifestSchema = z.object({
  version: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
});
const current = manifestSchema.parse(
  JSON.parse(readFileSync(new URL('current.json', root), 'utf8')),
);
export const CURRENT_CONTENT_PRINT_ENGINE = Object.freeze({
  version: 'invitation-content-v1' as const,
  digest: current.digest,
});
const require = createRequire(import.meta.url);
const artifacts = new Map<string, { css: string; render: (invitation: unknown) => unknown }>();
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Content = z.output<typeof printableFileContentSchema>;
type Image = { bytes: Buffer; width: number; height: number };

export function contentPrintHtml(content: Content, images: readonly Image[], qrDataUrl?: string) {
  const engine = content.renderer;
  if (!engine) throw new Error('A retained content renderer is required.');
  let artifact = artifacts.get(engine.digest);
  if (!artifact) {
    const directory = new URL(engine.digest + '/', root);
    const js = readFileSync(new URL('renderer.cjs', directory));
    const css = readFileSync(new URL('renderer.css', directory));
    if (createHash('sha256').update(js).update(css).digest('hex') !== engine.digest)
      throw new Error('Retained invitation renderer digest mismatch.');
    const module: unknown = require(fileURLToPath(new URL('renderer.cjs', directory)));
    if (
      !module ||
      typeof module !== 'object' ||
      !('renderInvitationMarkup' in module) ||
      typeof module.renderInvitationMarkup !== 'function'
    )
      throw new Error('Invalid retained invitation renderer.');
    artifact = {
      css: css.toString(),
      render: module.renderInvitationMarkup as (invitation: unknown) => unknown,
    };
    artifacts.set(engine.digest, artifact);
  }
  const assets = images.map((image) => ({
    url: 'data:image/png;base64,' + image.bytes.toString('base64'),
    width: image.width,
    height: image.height,
  }));
  const invitation = {
    ...(qrDataUrl ? { qrDataUrl } : {}),
    title: content.design.title,
    textFields: content.design.textFields,
    ...(content.design.presentation ? { presentation: content.design.presentation } : {}),
    event: {
      eventDate: content.timeline.eventDate,
      hallName: content.timeline.hallName,
      shiftCode: content.timeline.shiftCode,
      startTime: content.timeline.shiftStartTime,
    },
    timeline: content.timeline.items.map(({ order, startTime, title, description }) => ({
      order,
      startTime,
      title,
      description,
    })),
    sections: content.design.sections.map((section) => ({
      kind: section.kind,
      textKey: section.textKey,
      imageUrl: section.derivedAssetId
        ? (assets[content.design.derivedAssetIds.indexOf(section.derivedAssetId)]?.url ?? null)
        : null,
    })),
    assets,
    seating: content.seating ? publicSeating(content.seating.renderSnapshot) : null,
  };
  const markup = z
    .string()
    .max(80 * 1024 * 1024)
    .parse(artifact.render(invitation));
  const font = (file: string) =>
    readFileSync(new URL(`../../../../assets/fonts/${file}.ttf`, import.meta.url)).toString(
      'base64',
    );
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><style>@font-face{font-family:BeVietnamPro;src:url(data:font/ttf;base64,${font('BeVietnamPro-Regular')}) format('truetype');font-weight:400;font-style:normal}@font-face{font-family:BeVietnamPro;src:url(data:font/ttf;base64,${font('BeVietnamPro-SemiBold')}) format('truetype');font-weight:600 900;font-style:normal}${artifact.css}</style></head><body>${markup}</body></html>`;
}

const busy = () =>
  new AppError({
    status: 503,
    code: 'PRINT_RENDERER_BUSY',
    message: 'The print renderer is busy. Retry the retained file.',
  });
const waiters: Array<() => void> = [];
let occupied = false;
async function acquire() {
  if (!occupied) {
    occupied = true;
    return;
  }
  if (waiters.length >= 24) throw busy();
  await new Promise<void>((resolve, reject) => {
    const ready = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(ready);
      if (i >= 0) waiters.splice(i, 1);
      reject(busy());
    }, 15000);
    waiters.push(ready);
  });
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else occupied = false;
}
let browserPromise: Promise<Browser> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
async function browser() {
  clearTimeout(idle);
  if (!browserPromise) {
    const pending: Promise<Browser> = chromium
      .launch({ headless: true, timeout: 10000, args: ['--disable-dev-shm-usage'] })
      .then((instance) => {
        instance.once('disconnected', () => {
          if (browserPromise === pending) browserPromise = undefined;
        });
        return instance;
      })
      .catch((error: unknown) => {
        if (browserPromise === pending) browserPromise = undefined;
        throw error;
      });
    browserPromise = pending;
  }
  return browserPromise;
}

/** Offline Chromium prints the exact Content-tab component/CSS, pinned in each snapshot. */
export async function renderContentPrintPdf(input: {
  content: Content;
  contentDigest: string;
  createdAt: Date;
  images: readonly Image[];
}) {
  const qr = input.content.genericQrPayload
    ? await QRCode.toDataURL(input.content.genericQrPayload, {
        errorCorrectionLevel: 'M',
        width: 400,
      })
    : undefined;
  const html = contentPrintHtml(input.content, input.images, qr);
  await acquire();
  try {
    const instance = await browser();
    const context = await instance.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      offline: true,
      viewport: { width: 560, height: 794 },
    });
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      void context.close().catch(() => undefined);
    }, 12000);
    try {
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 8000 });
      await page.waitForFunction(
        "document.fonts.status === 'loaded' && document.fonts.check('14px BeVietnamPro') && [...document.images].every(img => img.complete && img.naturalWidth > 0)",
        undefined,
        { timeout: 8000 },
      );
      const raw = await page.pdf({
        format: 'A5',
        preferCSSPageSize: true,
        printBackground: true,
      });
      if (raw.length > 12 * 1024 * 1024)
        throw new AppError({
          status: 422,
          code: 'PRINT_ASSET_LIMIT',
          message: 'Print file exceeds the accepted size limit.',
        });
      const pdf = await PDFDocument.load(raw);
      if (pdf.getPageCount() > 24)
        throw new AppError({
          status: 422,
          code: 'PRINT_CONTENT_OVERFLOW',
          message: 'Invitation content exceeds 24 printable pages.',
        });
      pdf.setCreationDate(input.createdAt);
      pdf.setModificationDate(input.createdAt);
      pdf.setTitle(input.content.design.title);
      pdf.setCreator('Invitation Content');
      pdf.setProducer('invitation-content-v1');
      pdf.context.trailerInfo.ID = pdf.context.obj([
        PDFHexString.of(input.contentDigest.slice(0, 32)),
        PDFHexString.of(input.contentDigest.slice(0, 32)),
      ]);
      const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));
      if (bytes.length > 12 * 1024 * 1024)
        throw new AppError({
          status: 422,
          code: 'PRINT_ASSET_LIMIT',
          message: 'Print file exceeds the accepted size limit.',
        });
      return { bytes, sha256: sha(bytes), rendererVersion: 'invitation-content-v1' };
    } catch (error) {
      if (expired)
        throw new AppError({
          status: 504,
          code: 'PRINT_RENDERER_TIMEOUT',
          message: 'The retained print render timed out. Retry the same file.',
        });
      throw error;
    } finally {
      clearTimeout(deadline);
      await context.close();
    }
  } finally {
    release();
    if (!occupied) {
      idle = setTimeout(() => {
        const closing = browserPromise;
        browserPromise = undefined;
        void closing?.then((instance) => instance.close()).catch(() => undefined);
      }, 1000);
      idle.unref();
    }
  }
}
