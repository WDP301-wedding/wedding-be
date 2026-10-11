import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { ContractView } from '../domain/commercial-contract.js';

// Resolve from both src/modules/... and dist/modules/...; fonts ship with the backend.
const regular = readFileSync(
  fileURLToPath(new URL('../../../../assets/fonts/BeVietnamPro-Regular.ttf', import.meta.url)),
);
const semibold = readFileSync(
  fileURLToPath(new URL('../../../../assets/fonts/BeVietnamPro-SemiBold.ttf', import.meta.url)),
);
const money = (value: number) => value.toLocaleString('vi-VN') + ' VND';
export async function renderContractPdf(
  view: ContractView,
): Promise<Readonly<{ bytes: Buffer; sha256: string }>> {
  const content = view.document;
  const chunks: Buffer[] = [];
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 48,
    bufferPages: true,
    info: {
      Title: 'Hợp đồng tổ chức tiệc cưới',
      Author: content.restaurantName,
      CreationDate: new Date(view.createdAt),
      ModDate: new Date(view.approvedAt ?? view.submittedAt ?? view.createdAt),
    },
  });
  const complete = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdf.registerFont('Body', regular).registerFont('Heading', semibold);
  pdf
    .font('Heading')
    .fontSize(18)
    .text('Hợp đồng tổ chức tiệc cưới', { align: 'center', lineGap: 5 });
  pdf.moveDown().font('Body').fontSize(10);
  const paragraph = (value: string) => {
    pdf.text(value.normalize('NFC'), { lineGap: 4 });
    pdf.moveDown(0.4);
  };
  paragraph('Phiên bản ' + view.revisionNumber + ' · ' + view.revisionId);
  paragraph(
    'Trạng thái: ' +
      {
        DRAFT: 'Bản nháp',
        AWAITING_APPROVAL: 'Chờ hai bên duyệt',
        APPROVED: 'Hai bên đã duyệt',
        SUPERSEDED: 'Phiên bản cũ',
      }[view.state],
  );
  paragraph('Cô dâu: ' + (content.brideName ?? 'Chưa cung cấp'));
  paragraph('Chú rể: ' + (content.groomName ?? 'Chưa cung cấp'));
  paragraph('Nhà hàng: ' + content.restaurantName + ' — ' + content.restaurantAddress);
  paragraph('Sảnh: ' + content.hallName + ' · Ngày: ' + content.eventDate);
  paragraph(
    'Ca: ' +
      (content.shiftCode === 'LUNCH' ? 'Trưa' : 'Tối') +
      ' (' +
      content.shiftStartTime +
      '–' +
      content.shiftEndTime +
      ')',
  );
  paragraph('Số bàn: ' + content.tableCount + ' · Số khách dự kiến: ' + content.planningHeadcount);
  pdf
    .moveDown()
    .font('Heading')
    .fontSize(12)
    .text('Nội dung và giá trị thỏa thuận', { lineGap: 4 });
  pdf.moveDown(0.5).font('Body').fontSize(10);
  for (const [index, line] of content.lines.entries()) {
    if (pdf.y > pdf.page.height - 140) pdf.addPage();
    paragraph(
      index +
        1 +
        '. ' +
        line.name +
        ' (' +
        { MENU: 'Thực đơn', PRINT: 'In thiệp', SERVICE: 'Dịch vụ' }[line.category] +
        ')',
    );
    if (line.description) paragraph(line.description);
    const unit = line.unit === 'table' ? 'bàn' : line.unit === 'copy' ? 'thiệp' : line.unit;
    paragraph(
      'Số lượng: ' + line.quantity + ' ' + unit + ' · Đơn giá: ' + money(line.unitPriceVnd),
    );
    paragraph('Thành tiền: ' + money(line.lineTotalVnd));
  }
  pdf.font('Heading');
  paragraph('Tổng giá trị hợp đồng: ' + money(content.contractTotalVnd));
  paragraph('Tiền cọc (30%): ' + money(content.depositAmountVnd));
  pdf.font('Body');
  paragraph(content.incidentalClause);
  pdf.moveDown().font('Heading').fontSize(12).text('Lịch trình đã thỏa thuận', { lineGap: 4 });
  pdf.moveDown(0.5).font('Body').fontSize(10);
  for (const item of content.timeline)
    paragraph(
      item.startTime + ' · ' + item.title + (item.description ? ' — ' + item.description : ''),
    );
  paragraph('Phiên bản lịch trình: ' + content.timelineRevisionId);
  pdf.moveDown().font('Heading').fontSize(12).text('Thông tin xác nhận', { lineGap: 4 });
  pdf.moveDown(0.5).font('Body').fontSize(9);
  for (const approval of view.approvals) {
    paragraph(
      (approval.party === 'MANAGER' ? 'Quản lý' : 'Cặp đôi') +
        ': ' +
        approval.actorAccountId +
        ' · ' +
        approval.occurredAt +
        ' (UTC)',
    );
  }
  paragraph('Xác nhận trong hệ thống; không phải chữ ký số.');
  paragraph('Mã kiểm tra nội dung: ' + view.documentDigest);
  const range = pdf.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    pdf.switchToPage(page);
    pdf
      .font('Body')
      .fontSize(8)
      .text('Trang ' + (page + 1) + '/' + range.count, 48, pdf.page.height - 34, {
        lineBreak: false,
        align: 'center',
      });
  }
  pdf.end();
  const bytes = await complete;
  if (bytes.length > 8 * 1024 * 1024)
    throw new RangeError('Contract PDF exceeds the output limit.');
  return Object.freeze({ bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}
