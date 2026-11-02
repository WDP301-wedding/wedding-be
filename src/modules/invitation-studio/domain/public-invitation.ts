import { invitationPresentationSchema } from './invitation-presentation.js';
import { z } from 'zod';
import { textFieldsSchema, escapeText, type seatingRenderSchema } from './studio-policy.js';

export const publicSeatingSchema = z
  .array(
    z.strictObject({
      tableLabel: z.string().min(1).max(50),
      shape: z.enum(['ROUND', 'RECTANGLE']),
      x: z.int().min(0).max(10000),
      y: z.int().min(0).max(10000),
      width: z.int().min(1).max(10000),
      height: z.int().min(1).max(10000),
      rotationDegrees: z.int().min(0).max(359),
      guestGroupName: z.string().max(80).nullable(),
      color: z
        .string()
        .regex(/^#[A-F0-9]{6}$/u)
        .nullable(),
    }),
  )
  .min(1)
  .max(500);
export function publicSeating(tables: readonly z.infer<typeof seatingRenderSchema>[number][]) {
  return publicSeatingSchema.parse(
    tables.map((t) => ({
      tableLabel: t.tableLabel,
      shape: t.shape,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      rotationDegrees: t.rotationDegrees,
      guestGroupName: t.guestGroupName,
      color: t.color,
    })),
  );
}

export const publicInvitationSchema = z.object({
  publicInvitationId: z.uuid(),
  publishedRevisionId: z.uuid(),
  seating: publicSeatingSchema.nullable().optional(),
  title: z.string().min(1).max(120),
  presentation: invitationPresentationSchema.optional(),
  textFields: textFieldsSchema,
  sections: z
    .array(
      z.object({
        kind: z.enum(['HERO', 'MESSAGE', 'EVENT', 'TIMELINE', 'SEATING', 'FOOTER']),
        textKey: z.enum(['brideName', 'groomName', 'greeting', 'message', 'footer']).nullish(),
        imageUrl: z
          .string()
          .regex(/^\/api\/v1\/public\/invitation-assets\/[a-f0-9]{64}$/u)
          .nullish(),
      }),
    )
    .max(20),
  event: z.object({
    eventDate: z.iso.date(),
    hallName: z.string().min(1).max(120),
    shiftCode: z.enum(['LUNCH', 'DINNER']),
  }),
  timeline: z
    .array(
      z.object({
        order: z.int().nonnegative(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/u),
        title: z.string().min(1).max(120),
        description: z.string().max(2000).nullish(),
      }),
    )
    .max(100),
  assets: z
    .array(
      z.object({
        url: z.string().regex(/^\/api\/v1\/public\/invitation-assets\/[a-f0-9]{64}$/u),
        width: z.int().positive().max(2048),
        height: z.int().positive().max(2048),
        contentType: z.literal('image/png'),
      }),
    )
    .max(100),
  genericQrPayload: z.url(),
});
export type PublicInvitation = z.infer<typeof publicInvitationSchema>;

function renderPublicSeating(tables: z.infer<typeof publicSeatingSchema>) {
  const bounds = tables.map((t) => {
    const angle = (t.rotationDegrees * Math.PI) / 180;
    return {
      x: t.x + t.width / 2,
      y: t.y + t.height / 2,
      w: Math.abs(Math.cos(angle)) * t.width + Math.abs(Math.sin(angle)) * t.height,
      h: Math.abs(Math.sin(angle)) * t.width + Math.abs(Math.cos(angle)) * t.height,
    };
  });
  const minX = Math.min(...bounds.map((b) => b.x - b.w / 2));
  const minY = Math.min(...bounds.map((b) => b.y - b.h / 2));
  const width = Math.max(...bounds.map((b) => b.x + b.w / 2)) - minX;
  const height = Math.max(...bounds.map((b) => b.y + b.h / 2)) - minY;
  const margin = Math.max(width, height) * 0.04;
  const size = Math.min(...tables.map((t) => Math.min(t.width, t.height))) / 5;
  const shapes = tables
    .map((t) => {
      const cx = t.x + t.width / 2,
        cy = t.y + t.height / 2;
      const shape =
        t.shape === 'ROUND'
          ? `<ellipse cx="${cx}" cy="${cy}" rx="${t.width / 2}" ry="${t.height / 2}"/>`
          : `<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}"/>`;
      return `<g transform="rotate(${t.rotationDegrees} ${cx} ${cy})" fill="${t.color ?? '#FFFFFF'}" stroke="currentColor" stroke-width="${size / 15}">${shape}</g><text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="currentColor" stroke="#FFFFFF" stroke-width="${size / 6}" paint-order="stroke">${escapeText(t.tableLabel)}</text>`;
    })
    .join('');
  const legend = tables
    .map(
      (t) =>
        `<li>${escapeText(t.tableLabel)}${t.guestGroupName ? ' — ' + escapeText(t.guestGroupName) : ''}</li>`,
    )
    .join('');
  return `<section><h2>Sơ đồ bàn</h2><svg role="img" aria-label="Vị trí bàn" width="100%" viewBox="${minX - margin} ${minY - margin} ${width + margin * 2} ${height + margin * 2}">${shapes}</svg><ul>${legend}</ul></section>`;
}

/** Text-only approved structure; no user HTML/CSS/SVG, external assets or scripts. */
export function renderPublicInvitation(dto: PublicInvitation): string {
  const sections = dto.sections
    .filter((section) => section.kind !== 'SEATING' || !dto.seating)
    .map(
      (section) =>
        `<section><h2>${escapeText(section.kind)}</h2>${!section.textKey ? '' : `<p>${escapeText(dto.textFields[section.textKey] ?? '')}</p>`}${!section.imageUrl ? '' : `<img alt="" src="${escapeText(section.imageUrl)}">`}</section>`,
    )
    .join('');
  const timeline = dto.timeline
    .map(
      (item) =>
        `<li><time>${escapeText(item.startTime)}</time> ${escapeText(item.title)}${!item.description ? '' : `<p>${escapeText(item.description)}</p>`}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(dto.title)}</title></head><body><main><h1>${escapeText(dto.title)}</h1><p>${escapeText(dto.event.eventDate)} — ${escapeText(dto.event.hallName)}</p>${sections}<ol>${timeline}</ol>${dto.seating ? renderPublicSeating(dto.seating) : ''}</main></body></html>`;
}
