import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { ContractView } from '../domain/commercial-contract.js';

const regular = readFileSync(
  fileURLToPath(new URL('../../../../assets/fonts/BeVietnamPro-Regular.ttf', import.meta.url)),
);
const semibold = readFileSync(
  fileURLToPath(new URL('../../../../assets/fonts/BeVietnamPro-SemiBold.ttf', import.meta.url)),
);
const money = (value: number) => value.toLocaleString('vi-VN') + ' đ';
const date = (value: string) => value.split('-').reverse().join('/');
const instant = (value: string) =>
  new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const colors = {
  ink: '#27212a',
  accent: '#7d203e',
  muted: '#70656b',
  border: '#e5d9d4',
  paper: '#f8f2ed',
};
const states = {
  DRAFT: 'Bản nháp',
  AWAITING_APPROVAL: 'Chờ hai bên duyệt',
  APPROVED: 'Hai bên đã duyệt',
  SUPERSEDED: 'Phiên bản đã thay thế',
};

/** Layout only: approved content and retained bytes are never rewritten. */
export async function renderContractPdf(
  view: ContractView,
  options: Readonly<{ presentation?: boolean }> = {},
): Promise<Readonly<{ bytes: Buffer; sha256: string }>> {
  const content = view.document;
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 70, bottom: 60, left: 48, right: 48 },
    bufferPages: true,
    info: {
      Title: 'Hợp đồng tổ chức tiệc cưới',
      Author: content.restaurantName,
      CreationDate: new Date(view.createdAt),
      ModDate: new Date(view.approvedAt ?? view.submittedAt ?? view.createdAt),
    },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
  });
  pdf.registerFont('Body', regular).registerFont('Heading', semibold);
  const left = 48,
    width = pdf.page.width - 96,
    bottom = () => pdf.page.height - 68;
  const header = () => {
    pdf
      .font('Heading')
      .fontSize(9)
      .fillColor(colors.accent)
      .text(content.restaurantName.normalize('NFC'), left, 28, { width, lineBreak: false });
    pdf
      .moveTo(left, 49)
      .lineTo(left + width, 49)
      .lineWidth(0.6)
      .strokeColor(colors.border)
      .stroke();
    pdf.y = 70;
  };
  pdf.y = 70;
  const ensure = (height: number) => {
    if (pdf.y + height > bottom()) pdf.addPage();
  };
  const text = (value: string, bold = false, size = 9.5) => {
    pdf
      .font(bold ? 'Heading' : 'Body')
      .fontSize(size)
      .fillColor(colors.ink);
    const normalized = value.normalize('NFC');
    const height = pdf.heightOfString(normalized, { width, lineGap: 3 });
    ensure(Math.min(height + 8, bottom() - 70));
    pdf
      .font(bold ? 'Heading' : 'Body')
      .fontSize(size)
      .fillColor(colors.ink);
    pdf.text(normalized, left, pdf.y, { width, lineGap: 3 });
    pdf.y += 6;
  };
  const section = (title: string) => {
    ensure(65);
    pdf.y += 12;
    const y = pdf.y;
    pdf.rect(left, y, width, 28).fill(colors.paper);
    pdf
      .font('Heading')
      .fontSize(10.5)
      .fillColor(colors.accent)
      .text(title, left + 10, y + 7, { width: width - 20 });
    pdf.y = y + 39;
  };
  pdf
    .font('Heading')
    .fontSize(20)
    .fillColor(colors.accent)
    .text('Hợp đồng tổ chức tiệc cưới', left, pdf.y, { align: 'center', width, lineGap: 5 });
  pdf.y += 10;
  pdf
    .font('Body')
    .fontSize(9)
    .fillColor(colors.muted)
    .text(`Phiên bản ${view.revisionNumber}  |  ${states[view.state]}`, left, pdf.y, {
      width,
      align: 'center',
    });
  pdf.y += 12;
  if (options.presentation)
    text(
      'Bản trình bày từ nội dung đã lưu. Không thay thế tệp chứng từ gốc được lưu trữ.',
      false,
      8,
    );
  if (view.state === 'DRAFT' || view.state === 'AWAITING_APPROVAL')
    text('Nội dung chưa được hai bên xác nhận đầy đủ.', true);
  section('01. Thông tin các bên và tiệc cưới');
  text('Nhà hàng: ' + content.restaurantName, true);
  text('Địa chỉ: ' + (content.restaurantAddress || 'Chưa cung cấp'));
  text(
    'Cô dâu: ' +
      (content.brideName ?? 'Chưa cung cấp') +
      '    |    Chú rể: ' +
      (content.groomName ?? 'Chưa cung cấp'),
  );
  text('Sảnh: ' + content.hallName + '    |    Ngày tổ chức: ' + date(content.eventDate));
  text(
    'Ca tiệc: ' +
      (content.shiftCode === 'LUNCH' ? 'Trưa' : 'Tối') +
      ' (' +
      content.shiftStartTime +
      ' - ' +
      content.shiftEndTime +
      ')',
  );
  text(
    'Quy mô: ' +
      content.tableCount +
      ' bàn    |    ' +
      content.planningHeadcount +
      ' khách dự kiến',
  );
  section('02. Hạng mục và giá trị hợp đồng');
  const cols = [left, left + 27, left + 244, left + 324, left + 410];
  const widths = [23, 207, 70, 76, width - 410];
  const tableHeader = () => {
    ensure(48);
    const y = pdf.y;
    pdf.rect(left, y, width, 26).fill(colors.paper);
    ['STT', 'Hạng mục', 'Số lượng', 'Đơn giá', 'Thành tiền'].forEach((value, i) => {
      pdf
        .font('Heading')
        .fontSize(8)
        .fillColor(colors.ink)
        .text(value, cols[i], y + 7, { width: widths[i]!, align: i >= 2 ? 'right' : 'left' });
    });
    pdf.y = y + 33;
  };
  tableHeader();
  for (const [index, line] of content.lines.entries()) {
    pdf.font('Body').fontSize(8.5);
    const name = line.name.normalize('NFC');
    const unit = line.unit === 'table' ? 'bàn' : line.unit === 'copy' ? 'thiệp' : line.unit;
    const values = [
      String(index + 1),
      name,
      line.quantity + ' ' + unit,
      money(line.unitPriceVnd),
      money(line.lineTotalVnd),
    ];
    const height = Math.max(
      28,
      ...values.map((value, i) => {
        pdf.font(i === 4 ? 'Heading' : 'Body').fontSize(8.5);
        return pdf.heightOfString(value, { width: widths[i]!, lineGap: 2 }) + 12;
      }),
    );
    if (pdf.y + height > bottom()) {
      pdf.addPage();
      tableHeader();
    }
    const y = pdf.y;
    values.forEach((value, i) =>
      pdf
        .font(i === 4 ? 'Heading' : 'Body')
        .fontSize(8.5)
        .fillColor(colors.ink)
        .text(value, cols[i], y, {
          width: widths[i]!,
          align: i >= 2 ? 'right' : 'left',
          lineGap: 2,
        }),
    );
    pdf.y = y + height;
    if (line.description) text(line.description, false, 8);
    pdf
      .moveTo(left, pdf.y)
      .lineTo(left + width, pdf.y)
      .lineWidth(0.4)
      .strokeColor(colors.border)
      .stroke();
    pdf.y += 9;
  }
  ensure(90);
  pdf.y += 8;
  text('Tổng giá trị hợp đồng: ' + money(content.contractTotalVnd), true, 12);
  text('Tiền đặt cọc cam kết (30%): ' + money(content.depositAmountVnd), true, 11);
  text(content.incidentalClause);
  section('03. Lịch trình đã thỏa thuận');
  if (!content.timeline.length) text('Chưa có mốc chương trình trong phiên bản này.');
  for (const item of content.timeline) {
    ensure(45);
    text(item.startTime + '  |  ' + item.title, true);
    if (item.description) text(item.description, false, 9);
  }
  section('04. Xác nhận của các bên');
  for (const party of ['MANAGER', 'COUPLE'] as const) {
    const approval = view.approvals.find((item) => item.party === party);
    text(
      (party === 'MANAGER' ? 'Đại diện nhà hàng' : 'Đại diện cặp đôi') +
        ': ' +
        (approval ? 'Đã xác nhận lúc ' + instant(approval.occurredAt) : 'Chưa xác nhận'),
      true,
    );
    if (approval) text('Tài khoản xác nhận: ' + approval.actorAccountId, false, 8);
  }
  text('Xác nhận được ghi nhận trong hệ thống; không phải chữ ký số.', false, 8.5);
  text('Thời gian trong tài liệu sử dụng múi giờ Việt Nam (UTC+7).', false, 8);
  section('Thông tin đối chiếu phiên bản');
  text('Mã hợp đồng: ' + view.revisionId, false, 8);
  text('Mã lịch trình: ' + content.timelineRevisionId, false, 8);
  text('Mã kiểm tra nội dung (SHA-256): ' + view.documentDigest, false, 8);
  const range = pdf.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    pdf.switchToPage(page);
    const savedBottomMargin = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    header();
    pdf
      .font('Body')
      .fontSize(8)
      .fillColor(colors.muted)
      .text(
        (options.presentation ? 'Bản trình bày  |  ' : '') +
          'Phiên bản ' +
          view.revisionNumber +
          '  |  Trang ' +
          (page + 1) +
          '/' +
          range.count,
        left,
        pdf.page.height - 35,
        { width, lineBreak: false, align: 'center' },
      );
    pdf.page.margins.bottom = savedBottomMargin;
  }
  pdf.end();
  const bytes = await complete;
  if (bytes.length > 8 * 1024 * 1024)
    throw new RangeError('Contract PDF exceeds the output limit.');
  return Object.freeze({ bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}
