import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  designContentSchema,
  parseStudio,
  digest,
  escapeText,
  registerSeatingSchema,
} from './studio-policy.js';
import { publicInvitationSchema, renderPublicInvitation } from './public-invitation.js';
const content = {
  title: 'Wedding',
  textFields: { greeting: 'Welcome' },
  sections: [],
  derivedAssetIds: [],
  includesSeating: false,
};
describe('Structured invitation safety and bounds', () => {
  it.each([
    '<script>alert(1)</script>',
    '<svg>',
    'https://external.test',
    'data:image/png;base64,x',
    'javascript:alert(1)',
    'accessToken',
  ])('rejects active or remote content %s', (title) => {
    expect(() => parseStudio(designContentSchema, { ...content, title })).toThrow();
  });
  it.each([
    { title: '' },
    { title: 'x'.repeat(121) },
    { textFields: { message: 'x'.repeat(2001) } },
    { html: 'hidden' },
    {
      sections: Array.from({ length: 21 }, () => ({
        kind: 'HERO',
        textKey: null,
        derivedAssetId: null,
      })),
    },
    { includesSeating: true },
    {
      derivedAssetIds: [randomUUID(), randomUUID()],
      sections: [{ kind: 'HERO', textKey: null, derivedAssetId: randomUUID() }],
    },
  ])('rejects invalid structures %#', (invalid) => {
    expect(designContentSchema.safeParse({ ...content, ...invalid }).success).toBe(false);
  });
  it('retains boundary-length Unicode text, prevents duplicate references, and canonicalizes hashes', () => {
    expect(
      designContentSchema.parse({
        ...content,
        title: 'a'.repeat(120),
        textFields: { message: 'á'.repeat(2000) },
      }).title,
    ).toHaveLength(120);
    const id = randomUUID();
    expect(designContentSchema.safeParse({ ...content, derivedAssetIds: [id, id] }).success).toBe(
      false,
    );
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(escapeText('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('renders approved timeline/hall as escaped text and prevents private or remote public projections', () => {
    const dto = publicInvitationSchema.parse({
      publicInvitationId: randomUUID(),
      publishedRevisionId: randomUUID(),
      title: content.title,
      textFields: content.textFields,
      sections: content.sections,
      event: { eventDate: '2026-10-15', hallName: '<script>Hall</script>', shiftCode: 'LUNCH' },
      timeline: [
        { order: 0, startTime: '11:00', title: '<img onerror=x>', description: '& welcome' },
      ],
      assets: [],
      genericQrPayload: 'https://wedding.example.test/invitations/opaque',
    });
    const html = renderPublicInvitation(dto);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img onerror=x&gt;');
    const imageUrl = '/api/v1/public/invitation-assets/' + 'a'.repeat(64);
    const withSections = renderPublicInvitation({
      ...dto,
      sections: [
        { kind: 'HERO', textKey: null, imageUrl },
        { kind: 'FOOTER', textKey: 'footer', imageUrl: null },
      ],
    });
    expect(withSections).toContain(`<img alt="" src="${imageUrl}">`);
    expect(withSections).toContain('<p></p>');
    expect(publicInvitationSchema.safeParse({ ...dto, bookingId: randomUUID() }).success).toBe(
      false,
    );
    expect(
      publicInvitationSchema.safeParse({
        ...dto,
        assets: [
          { url: 'https://remote.test/original', width: 1, height: 1, contentType: 'image/png' },
        ],
      }).success,
    ).toBe(false);
  });
  it('rejects group null mismatch, wrong digest format, oversized and duplicate seating geometry', () => {
    const table = {
      layoutTableId: randomUUID(),
      tableLabel: 'T',
      shape: 'ROUND',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotationDegrees: 0,
      guestGroupId: null,
      guestGroupName: null,
      color: null,
    };
    const input = {
      bookingId: randomUUID(),
      seatingPlanRevisionId: randomUUID(),
      seatingPlanRevisionNumber: 1,
      layoutTemplateVersionId: randomUUID(),
      contentDigest: 'a'.repeat(64),
      renderSnapshot: [table],
    };
    expect(registerSeatingSchema.safeParse(input).success).toBe(true);
    for (const renderSnapshot of [
      [{ ...table, color: '#ABCDEF' }],
      [table, table],
      [{ ...table, width: 10001 }],
      [{ ...table, rotationDegrees: 360 }],
    ])
      expect(registerSeatingSchema.safeParse({ ...input, renderSnapshot }).success).toBe(false);
  });
});
