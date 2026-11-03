import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { digest } from '../domain/studio-policy.js';
import { renderPrintablePdf } from './print-file.renderer.js';
import { CURRENT_CONTENT_PRINT_ENGINE, contentPrintHtml } from './content-print.renderer.js';

export function seatingPrintFixture() {
  const groupId = randomUUID();
  return {
    renderer: CURRENT_CONTENT_PRINT_ENGINE,
    design: {
      title: 'Thiệp Cưới Hạnh Phúc',
      presentation: {
        version: 1 as const,
        theme: 'blush-floral' as const,
        layout: 'gatefold' as const,
      },
      textFields: {
        brideName: 'Ngọc Ánh',
        groomName: 'Đức Minh',
        greeting: 'Trân trọng kính mời',
        message: 'Cùng chung vui ngày hạnh phúc của hai gia đình.',
        footer: 'Hân hạnh đón tiếp quý khách.',
      },
      sections: [{ kind: 'SEATING' as const, textKey: null, derivedAssetId: null }],
      derivedAssetIds: [],
      includesSeating: true,
    },
    timeline: {
      bookingId: randomUUID(),
      timelineRevisionId: randomUUID(),
      revisionNumber: 1,
      eventDate: '2027-01-06',
      hallName: 'Sảnh Hoa Sen',
      shiftCode: 'DINNER' as const,
      shiftStartTime: '18:00',
      shiftEndTime: '22:00',
      items: Array.from({ length: 5 }, (_, order) => ({
        itemId: randomUUID(),
        order,
        startTime: '18:00',
        title: `Chương trình ${order + 1}`,
        description: 'Chào mừng hai bên gia đình và quý khách cùng chung vui ngày trọng đại.',
      })),
      approvedByManagerAt: '2026-10-11T00:00:00Z',
      approvedByCoupleAt: '2026-10-11T00:00:00Z',
      isEffective: true,
    },
    seating: {
      seatingPlanRevisionId: randomUUID(),
      renderSnapshot: Array.from({ length: 24 }, (_, i) => ({
        layoutTableId: randomUUID(),
        tableLabel: `Bàn ${i + 1}`,
        shape: i % 2 ? ('RECTANGLE' as const) : ('ROUND' as const),
        x: (i % 6) * 600,
        y: Math.floor(i / 6) * 600,
        width: 450,
        height: 350,
        rotationDegrees: i === 1 ? 45 : 0,
        guestGroupId: groupId,
        guestGroupName: 'Gia đình cô dâu',
        color: '#059669',
      })),
    },
    genericQrPayload: null,
    publicInvitationId: null,
    publishedRevisionId: null,
  };
}
const render = (content: ReturnType<typeof seatingPrintFixture>) =>
  renderPrintablePdf({
    content,
    contentDigest: digest(content),
    createdAt: new Date('2026-11-04T00:00:00Z'),
    images: new Map(),
  });
describe('Content-tab print renderer', () => {
  it('bounds the combined decoded image size before launching the browser', async () => {
    const content = seatingPrintFixture();
    const ids = [randomUUID(), randomUUID()];
    const snapshot = { ...content, design: { ...content.design, derivedAssetIds: ids } };
    const png = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    await expect(
      renderPrintablePdf({
        content: snapshot,
        contentDigest: digest(snapshot),
        createdAt: new Date(),
        images: new Map(ids.map((id) => [id, png])),
      }),
    ).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT', status: 422 });
  });
  it('reproduces legacy seating overflow, then renders the same full invitation and table map in separate reading pages', async () => {
    const content = seatingPrintFixture();
    const { renderer: _renderer, ...legacy } = content;
    void _renderer;
    await expect(
      renderPrintablePdf({
        content: legacy,
        contentDigest: digest(legacy),
        createdAt: new Date(),
        images: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'PRINT_CONTENT_OVERFLOW' });
    const result = await render(content);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);
    expect(pdf.getPageCount()).toBeLessThanOrEqual(7);
    expect(result.rendererVersion).toBe('invitation-content-v1');
    expect(pdf.getTitle()).toBe(content.design.title);
    const html = contentPrintHtml(content, []);
    expect(html).toContain('data-print-page="Sơ đồ bàn"');
    expect(html).toContain('Bàn 24');
    expect(html).toContain('Chương trình 5');
    expect(html).toContain('rotate(45');
    expect(html).not.toContain(content.timeline.bookingId);
    expect(html).not.toContain(content.seating.renderSnapshot[0]!.layoutTableId);
  }, 20000);
  it('replays deterministic bytes and keeps retained rendering independent of the current UI head', async () => {
    const content = seatingPrintFixture();
    const first = await render(content),
      second = await render(content);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
  }, 20000);
  it('escapes authored text, contains no remote resources and rejects unknown engine identity', () => {
    const content = seatingPrintFixture();
    content.design.textFields.message = 'Gia đình & người thân';
    const html = contentPrintHtml(content, []);
    expect(html).toContain('Gia đình &amp; người thân');
    expect(html).not.toMatch(/(?:src|href)="https?:/u);
    expect(html).toContain("default-src 'none'");
    expect(() =>
      contentPrintHtml(
        { ...content, renderer: { ...content.renderer, digest: '0'.repeat(64) } },
        [],
      ),
    ).toThrow();
  });
});
