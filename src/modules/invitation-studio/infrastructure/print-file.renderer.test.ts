import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { digest } from '../domain/studio-policy.js';
import { renderPrintablePdf, PRINT_MAX_IMAGE_BYTES } from './print-file.renderer.js';

const content = () => ({
  design: {
    title: 'Thiệp cưới',
    textFields: {
      brideName: 'Ngọc Ánh',
      groomName: 'Đức Minh',
      greeting: 'Trân trọng kính mời',
      message: 'Cùng chung vui',
      footer: 'Hân hạnh đón tiếp',
    },
    sections: [],
    derivedAssetIds: [] as string[],
    includesSeating: false,
  },
  timeline: {
    bookingId: randomUUID(),
    timelineRevisionId: randomUUID(),
    revisionNumber: 1,
    eventDate: '2027-01-06',
    hallName: 'Sảnh Hoa Sen',
    shiftCode: 'DINNER',
    shiftStartTime: '18:00',
    shiftEndTime: '22:00',
    items: [
      {
        itemId: randomUUID(),
        order: 0,
        startTime: '18:00',
        title: 'Đón khách',
        description: 'Chào mừng quý khách',
      },
    ],
    approvedByManagerAt: '2026-10-11T00:00:00Z',
    approvedByCoupleAt: '2026-10-11T00:00:00Z',
    isEffective: true,
  },
  seating: null,
  genericQrPayload: 'https://wedding.example.test/api/v1/public/invitations/' + 'a'.repeat(64),
  publicInvitationId: randomUUID(),
  publishedRevisionId: randomUUID(),
});
const render = (c: ReturnType<typeof content>, images: Map<string, Uint8Array> = new Map()) =>
  renderPrintablePdf({
    content: c,
    contentDigest: digest(c),
    createdAt: new Date('2026-10-11T00:00:00Z'),
    images,
  });
describe('accepted A5 immutable print renderer', () => {
  it('renders exact round/rotated rectangle geometry with shared Vietnamese Group legend', async () => {
    const c = content(),
      groupId = randomUUID();
    const tables = [0, 1, 2].map((i) => ({
      layoutTableId: randomUUID(),
      tableLabel: `B${i + 1}`,
      shape: i === 0 ? ('ROUND' as const) : ('RECTANGLE' as const),
      x: i * 600,
      y: 0,
      width: 450,
      height: 350,
      rotationDegrees: i === 1 ? 45 : 0,
      guestGroupId: i === 2 ? null : groupId,
      guestGroupName: i === 2 ? null : 'Gia đình cô dâu',
      color: i === 2 ? null : '#059669',
    }));
    const snapshot = {
      ...c,
      design: {
        ...c.design,
        sections: [{ kind: 'SEATING' as const, textKey: null, derivedAssetId: null }],
        includesSeating: true,
      },
      seating: { seatingPlanRevisionId: randomUUID(), renderSnapshot: tables },
    };
    const a = await renderPrintablePdf({
      content: snapshot,
      contentDigest: digest(snapshot),
      createdAt: new Date('2026-10-12T00:00:00Z'),
      images: new Map(),
    });
    expect(a.rendererVersion).toBe('invitation-a5-v2-seating');
    expect(a.bytes.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(2);
  });
  it('rejects illegible table labels and legends that do not fit instead of changing geometry', async () => {
    const c = content();
    const table = {
      layoutTableId: randomUUID(),
      tableLabel: 'Bàn 1',
      shape: 'RECTANGLE' as const,
      x: 0,
      y: 0,
      width: 10000,
      height: 1,
      rotationDegrees: 0,
      guestGroupId: null,
      guestGroupName: null,
      color: null,
    };
    const snapshot = {
      ...c,
      design: {
        ...c.design,
        sections: [{ kind: 'SEATING' as const, textKey: null, derivedAssetId: null }],
        includesSeating: true,
      },
      seating: { seatingPlanRevisionId: randomUUID(), renderSnapshot: [table] },
    };
    await expect(
      renderPrintablePdf({
        content: snapshot,
        contentDigest: digest(snapshot),
        createdAt: new Date(),
        images: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'PRINT_CONTENT_OVERFLOW' });
    const legendOverflow = {
      ...snapshot,
      seating: {
        ...snapshot.seating,
        renderSnapshot: Array.from({ length: 15 }, (_, i) => ({
          ...table,
          layoutTableId: randomUUID(),
          width: 500,
          height: 500,
          y: i * 600,
          guestGroupId: randomUUID(),
          guestGroupName: 'Gia đình cô dâu',
          color: '#059669',
        })),
      },
    };
    await expect(
      renderPrintablePdf({
        content: legendOverflow,
        contentDigest: digest(legendOverflow),
        createdAt: new Date(),
        images: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'PRINT_CONTENT_OVERFLOW' });
  });
  it('embeds fonts, two physical pages and deterministic file bytes', async () => {
    const c = content(),
      a = await render(c),
      b = await render(c);
    expect(a.bytes.equals(b.bytes)).toBe(true);
    expect(a.bytes.toString('latin1')).toContain('/TrimBox');
    expect(a.bytes.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(2);
    expect(a.bytes.toString('latin1')).toContain('/FontFile2');
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('renders decoded retained images and handles omitted optional text', async () => {
    const c = content(),
      id = randomUUID();
    c.design.derivedAssetIds = [id];
    c.design.textFields.greeting = '';
    c.timeline.items[0]!.description = null as unknown as string;
    const png = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#f0ddc9' },
    })
      .png()
      .toBuffer();
    expect((await render(c, new Map([[id, png]]))).bytes.toString('latin1')).toContain(
      '/Subtype /Image',
    );
  });
  it('fails closed for changed snapshots, seating and invalid schemas', async () => {
    const c = content();
    await expect(
      renderPrintablePdf({
        content: c,
        contentDigest: '0'.repeat(64),
        createdAt: new Date(),
        images: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'PRINTABLE_DIGEST_CONFLICT' });
    await expect(render({ ...c, seating: [] } as unknown as typeof c)).rejects.toMatchObject({
      status: 422,
    });
    await expect(render({ ...c, surprise: true } as typeof c)).rejects.toMatchObject({
      status: 422,
    });
  });
  it('rejects oversized text instead of clipping or adding pages', async () => {
    const c = content();
    c.design.textFields.greeting = 'Mời quý khách '.repeat(130);
    await expect(render(c)).rejects.toMatchObject({ code: 'PRINT_CONTENT_OVERFLOW' });
  });
  it('bounds image counts/bytes and rejects missing/corrupt/unsupported pixels', async () => {
    const c = content(),
      id = randomUUID();
    c.design.derivedAssetIds = [id];
    await expect(render(c)).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT' });
    await expect(render(c, new Map([[randomUUID(), new Uint8Array([1])]]))).rejects.toMatchObject({
      status: 502,
    });
    await expect(
      render(c, new Map([[id, new Uint8Array(PRINT_MAX_IMAGE_BYTES + 1)]])),
    ).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT' });
    await expect(render(c, new Map([[id, new Uint8Array([1])]]))).rejects.toMatchObject({
      status: 502,
    });
    const jpeg = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    await expect(render(c, new Map([[id, jpeg]]))).rejects.toMatchObject({ status: 502 });
    c.design.derivedAssetIds = Array.from({ length: 9 }, () => randomUUID());
    await expect(
      render(c, new Map(c.design.derivedAssetIds.map((key) => [key, jpeg]))),
    ).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT' });
  });
});
