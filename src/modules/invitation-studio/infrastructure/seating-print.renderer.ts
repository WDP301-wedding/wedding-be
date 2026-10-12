import type PDFDocument from 'pdfkit';
import type { z } from 'zod';
import type { seatingRenderSchema } from '../domain/studio-policy.js';
import { AppError } from '../../../core/errors/app-error.js';
const overflow = (): never => {
  throw new AppError({
    status: 422,
    code: 'PRINT_CONTENT_OVERFLOW',
    message: 'Seating content cannot fit legibly in the accepted print format.',
  });
};
/** Uniformly scale the exact immutable catalog coordinates; never rearrange tables.
 * Bounds include rotation. Shapes carry color; a textual legend keeps Group guidance
 * usable without color. Reject unreadable geometry instead of clipping or reflowing. */
export function renderSeating(
  pdf: InstanceType<typeof PDFDocument>,
  tables: z.output<typeof seatingRenderSchema>,
  input: { left: number; top: number; width: number; bottom: number },
) {
  const groups = new Map<string, { name: string; color: string; labels: string[] }>();
  for (const table of tables)
    if (table.guestGroupId !== null) {
      const group = groups.get(table.guestGroupId) ?? {
        name: table.guestGroupName!,
        color: table.color!,
        labels: [],
      };
      group.labels.push(table.tableLabel);
      groups.set(table.guestGroupId, group);
    }
  pdf.font('Body').fontSize(8);
  const legend = [...groups.values()].map((g) => ({
    ...g,
    text: `${g.name}: ${g.labels.join(', ')}`,
  }));
  const legendHeight = legend.reduce(
    (sum, g) => sum + pdf.heightOfString(g.text, { width: input.width - 14, lineGap: 2 }) + 5,
    0,
  );
  const diagramHeight = Math.min(156, input.bottom - input.top - legendHeight - 32);
  if (diagramHeight < 80) overflow();
  const bounds = tables.map((t) => {
    const radians = (t.rotationDegrees * Math.PI) / 180;
    const w = Math.abs(Math.cos(radians)) * t.width + Math.abs(Math.sin(radians)) * t.height;
    const h = Math.abs(Math.sin(radians)) * t.width + Math.abs(Math.cos(radians)) * t.height;
    return { cx: t.x + t.width / 2, cy: t.y + t.height / 2, w, h };
  });
  const minX = Math.min(...bounds.map((b) => b.cx - b.w / 2)),
    maxX = Math.max(...bounds.map((b) => b.cx + b.w / 2));
  const minY = Math.min(...bounds.map((b) => b.cy - b.h / 2)),
    maxY = Math.max(...bounds.map((b) => b.cy + b.h / 2));
  const scale = Math.min((input.width - 12) / (maxX - minX), (diagramHeight - 12) / (maxY - minY));
  const originX = input.left + (input.width - (maxX - minX) * scale) / 2,
    originY = input.top + 20 + (diagramHeight - (maxY - minY) * scale) / 2;
  pdf
    .font('Heading')
    .fontSize(10)
    .fillColor('#342a29')
    .text('Sơ đồ bàn theo nhóm', input.left, input.top, { width: input.width, align: 'center' });
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!,
      b = bounds[i]!,
      w = table.width * scale,
      h = table.height * scale;
    const cx = originX + (b.cx - minX) * scale,
      cy = originY + (b.cy - minY) * scale;
    pdf.font('Body').fontSize(7);
    // Keep each table label inside its shape, including rotated rectangles.
    const labelWidth = pdf.widthOfString(table.tableLabel) + 6,
      labelHeight = pdf.heightOfString(table.tableLabel, { width: labelWidth });
    const r = (table.rotationDegrees * Math.PI) / 180;
    const localWidth = Math.abs(Math.cos(r)) * labelWidth + Math.abs(Math.sin(r)) * labelHeight;
    const localHeight = Math.abs(Math.sin(r)) * labelWidth + Math.abs(Math.cos(r)) * labelHeight;
    if (
      localWidth > w * (table.shape === 'ROUND' ? 0.7 : 0.9) ||
      localHeight > h * (table.shape === 'ROUND' ? 0.7 : 0.9)
    )
      overflow();
    pdf.save().translate(cx, cy).rotate(table.rotationDegrees).lineWidth(0.6);
    if (table.shape === 'ROUND') pdf.ellipse(0, 0, w / 2, h / 2);
    else pdf.rect(-w / 2, -h / 2, w, h);
    pdf.fillAndStroke(table.color ?? '#FFFFFF', '#342a29').restore();
    // White label backing keeps dark Group colors legible.
    pdf.rect(cx - labelWidth / 2, cy - labelHeight / 2, labelWidth, labelHeight).fill('#FFFFFF');
    pdf
      .fillColor('#342a29')
      .font('Body')
      .fontSize(7)
      .text(table.tableLabel, cx - labelWidth / 2, cy - labelHeight / 2, {
        width: labelWidth,
        align: 'center',
        lineBreak: false,
      });
  }
  let y = input.top + diagramHeight + 24;
  for (const group of legend) {
    pdf.rect(input.left, y + 2, 7, 7).fillAndStroke(group.color, '#342a29');
    pdf.font('Body').fontSize(8).fillColor('#342a29');
    const height = pdf.heightOfString(group.text, { width: input.width - 14, lineGap: 2 });
    pdf.text(group.text, input.left + 14, y, { width: input.width - 14, lineGap: 2 });
    y += height + 5;
  }
  return y;
}
