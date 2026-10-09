import { z } from 'zod';
import { textFieldsSchema, escapeText } from './studio-policy.js';

export const publicInvitationSchema = z.strictObject({
  publicInvitationId: z.uuid(),
  publishedRevisionId: z.uuid(),
  title: z.string().min(1).max(120),
  textFields: textFieldsSchema,
  sections: z
    .array(
      z.strictObject({
        kind: z.enum(['HERO', 'MESSAGE', 'EVENT', 'TIMELINE', 'SEATING', 'FOOTER']),
        textKey: z.enum(['brideName', 'groomName', 'greeting', 'message', 'footer']).nullable(),
        imageUrl: z
          .string()
          .regex(/^\/api\/v1\/public\/invitation-assets\/[a-f0-9]{64}$/u)
          .nullable(),
      }),
    )
    .max(20),
  event: z.strictObject({
    eventDate: z.iso.date(),
    hallName: z.string().min(1).max(120),
    shiftCode: z.enum(['LUNCH', 'DINNER']),
  }),
  timeline: z
    .array(
      z.strictObject({
        order: z.int().nonnegative(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/u),
        title: z.string().min(1).max(120),
        description: z.string().max(2000).nullable(),
      }),
    )
    .max(100),
  assets: z
    .array(
      z.strictObject({
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

/** Text-only approved structure; no user HTML/CSS/SVG, external assets or scripts. */
export function renderPublicInvitation(dto: PublicInvitation): string {
  const sections = dto.sections
    .map(
      (section) =>
        `<section><h2>${escapeText(section.kind)}</h2>${section.textKey === null ? '' : `<p>${escapeText(dto.textFields[section.textKey] ?? '')}</p>`}${section.imageUrl === null ? '' : `<img alt="" src="${escapeText(section.imageUrl)}">`}</section>`,
    )
    .join('');
  const timeline = dto.timeline
    .map(
      (item) =>
        `<li><time>${escapeText(item.startTime)}</time> ${escapeText(item.title)}${item.description === null ? '' : `<p>${escapeText(item.description)}</p>`}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeText(dto.title)}</title></head><body><main><h1>${escapeText(dto.title)}</h1><p>${escapeText(dto.event.eventDate)} — ${escapeText(dto.event.hallName)}</p>${sections}<ol>${timeline}</ol></main></body></html>`;
}
