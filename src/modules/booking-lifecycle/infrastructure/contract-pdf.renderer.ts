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
  const terms = content.standardTerms;
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
    ensure(terms ? 102 : 65);
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
  if (terms) {
    pdf
      .font('Heading')
      .fontSize(10)
      .fillColor(colors.ink)
      .text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', left, pdf.y, { width, align: 'center' });
    pdf.font('Body').fontSize(9).text('Độc lập - Tự do - Hạnh phúc', { width, align: 'center' });
    pdf.moveDown();
  }
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
    .text(
      `Phiên bản ${view.revisionNumber}  |  ${terms && view.state === 'AWAITING_APPROVAL' ? 'Bản xem trước · ' : ''}${states[view.state]}`,
      left,
      pdf.y,
      {
        width,
        align: 'center',
      },
    );
  pdf.y += 12;
  if (options.presentation)
    text(
      'Bản trình bày từ nội dung đã lưu. Không thay thế tệp chứng từ gốc được lưu trữ.',
      false,
      8,
    );
  if (view.state === 'DRAFT' || view.state === 'AWAITING_APPROVAL')
    text('Nội dung chưa được hai bên xác nhận đầy đủ.', true);
  section(terms ? 'Điều 1. Các bên và phạm vi hợp đồng' : '01. Thông tin các bên và tiệc cưới');
  text((terms ? 'Bên A · Nhà hàng: ' : 'Nhà hàng: ') + content.restaurantName, true);
  text('Địa chỉ: ' + (content.restaurantAddress || 'Chưa cung cấp'));
  text(
    (terms ? 'Bên B · Cô dâu: ' : 'Cô dâu: ') +
      (content.brideName ?? 'Chưa cung cấp') +
      '    |    Chú rể: ' +
      (content.groomName ?? 'Chưa cung cấp'),
  );
  if (terms) {
    text(
      'Bên A cung cấp sảnh, thực đơn, nhân sự phục vụ và các hạng mục đã thỏa thuận. Bên B phối hợp tổ chức và thanh toán theo Điều 5.',
    );
    section('Điều 2. Thông tin tiệc và lịch trình');
  }
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
  const timeline = () => {
    if (!content.timeline.length) text('Chưa có mốc chương trình trong phiên bản này.');
    for (const item of content.timeline) {
      ensure(45);
      text(item.startTime + '  |  ' + item.title, true);
      if (item.description) text(item.description, false, 9);
    }
  };
  if (terms) timeline();
  section(terms ? 'Điều 3. Dịch vụ và bảng giá' : '02. Hạng mục và giá trị hợp đồng');
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
    const guaranteeBadge = line.priceGuarantee ? ' [Đã bảo đảm giá]' : '';
    const name = (line.name + guaranteeBadge).normalize('NFC');
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
    const menu = terms?.orderedMenus.find(({ versionId }) => versionId === line.sourceRevisionId);
    const details = [line.description];
    if (line.category === 'MENU' && menu) details.push('Thực đơn: ' + menu.dishes.join(', '));
    pdf.font('Body').fontSize(8);
    const detailsHeight = details.reduce(
      (total, detail) =>
        total + (detail ? pdf.heightOfString(detail, { width, lineGap: 3 }) + 8 : 0),
      0,
    );
    if (pdf.y + height + (terms ? Math.min(detailsHeight, 110) + 9 : 0) > bottom()) {
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
    for (const detail of details) if (detail) text(detail, false, 8);
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
  if (terms) {
    text('Đơn giá và tổng tiền đã bao gồm thuế GTGT.', true);
    renderStandardTerms(view, terms, section, text);
    // Keep the effectiveness clause, audit details and handwritten signatures together.
    ensure(385);
    section('Điều 10. Hiệu lực và xác nhận');
    text(
      'Hợp đồng có hiệu lực khi hai bên xác nhận cùng phiên bản trên hệ thống. Hệ thống khóa bản gốc và lưu PDF để hai bên tải lại. Việc xác nhận giữ sảnh thực hiện theo Điều 5.1.',
    );
  } else {
    const depositPct = content.depositRate ?? 30;
    text(`Tiền đặt cọc cam kết (${depositPct}%): ` + money(content.depositAmountVnd), true, 11);
    text(content.incidentalClause);
    section('03. Lịch trình đã thỏa thuận');
    timeline();
    section('04. Xác nhận của các bên');
  }
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
  if (terms) {
    ensure(132);
    const y = pdf.y + 14;
    const columnWidth = (width - 28) / 2;
    for (const [index, party] of ['ĐẠI DIỆN BÊN A', 'ĐẠI DIỆN BÊN B'].entries()) {
      const x = left + index * (columnWidth + 28);
      pdf.font('Heading').fontSize(10).fillColor(colors.ink).text(party, x, y, {
        width: columnWidth,
        align: 'center',
      });
      pdf
        .font('Body')
        .fontSize(9)
        .text(
          index === 0 ? '(Ký, ghi rõ họ tên và đóng dấu nếu áp dụng)' : '(Ký, ghi rõ họ tên)',
          x,
          y + 17,
          { width: columnWidth, align: 'center' },
        );
      pdf
        .moveTo(x + 20, y + 100)
        .lineTo(x + columnWidth - 20, y + 100)
        .lineWidth(0.5)
        .strokeColor(colors.muted)
        .stroke();
    }
  }
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

// The terms below belong to WEDDING_STANDARD_V1. Introduce a new version when they change.
function renderStandardTerms(
  { document }: ContractView,
  terms: NonNullable<ContractView['document']['standardTerms']>,
  section: (title: string) => void,
  text: (value: string, bold?: boolean, size?: number) => void,
) {
  section('Điều 4. Hạng mục nhà hàng hỗ trợ');
  [
    'Hoa tươi cho bàn bánh cưới, bàn champagne và bàn ký tên.',
    'Thùng đựng tiền mừng.',
    'Phông chữ sân khấu theo nội dung đã chốt.',
    'Bữa ăn nhẹ cho cô dâu và chú rể.',
    'Bánh khai vị hoặc đậu phộng cho khách theo lựa chọn đã chốt.',
    'Máy chiếu trong ca tiệc.',
    `Tối đa 02 bàn dự phòng miễn phí, gồm bàn ghế, phục vụ và thực đơn ${terms.reserveMenu.name}, gói có giá thấp nhất của nhà hàng tại thời điểm gửi duyệt.`,
  ].forEach((item, i) => text(`${i + 1}. ${item}`));
  text('Món ăn của bàn dự phòng: ' + terms.reserveMenu.dishes.join(', ') + '.');
  text(
    'Khi số khách có mặt vượt số chỗ của các bàn đã đặt, đại diện Bên B có thể yêu cầu mở từng bàn dự phòng theo nhu cầu trong giới hạn sức chứa của sảnh. Đồ uống theo thỏa thuận chung của tiệc. Bàn dự phòng không quy đổi thành tiền. Từ bàn phát sinh thứ ba, Bên A chỉ phục vụ nếu còn sức chứa và đại diện Bên B đồng ý với đơn giá trước.',
  );

  section('Điều 5. Hai mốc thanh toán');
  const depositPct = document.depositRate ?? 30;
  text(`5.1. Đặt cọc ${depositPct}%: ` + money(document.depositAmountVnd), true, 11);
  text(
    'Bên B đặt cọc trong thời hạn giữ chỗ sau khi hai bên duyệt hợp đồng và lịch trình tương ứng. Sảnh và ca tiệc được xác nhận khi hệ thống ghi nhận cọc thành công theo điều kiện giữ chỗ.',
  );
  text(
    '5.2. Tất toán sau tiệc, tạm tính: ' +
      money(document.contractTotalVnd - document.depositAmountVnd),
    true,
    11,
  );
  text(
    'Trong 03 ngày làm việc kể từ khi nhận hóa đơn cuối, Bên B thanh toán phần còn phải trả. Số dư được tính từ giá trị hợp đồng gốc, cộng chênh lệch phụ lục đã duyệt và phát sinh có căn cứ, rồi trừ tiền đã thanh toán ròng sau hoàn tiền.',
  );
  text(
    document.incidentalClause +
      '. Bên A gửi bảng đối soát chi tiết. Hạng mục Bên B yêu cầu thêm cần được đại diện Bên B đồng ý về số lượng và giá trước khi cung cấp.',
  );

  section('Điều 6. Trách nhiệm và thay đổi dịch vụ');
  text(
    'Bên A bố trí sảnh, thực đơn và nhân sự theo thỏa thuận, bảo đảm an toàn thực phẩm. Bên B chốt thực đơn, số bàn và nội dung phông sân khấu chậm nhất 07 ngày trước giờ bắt đầu ca, thông báo nhu cầu ăn uống đặc biệt và cử đại diện xác nhận phát sinh.',
  );
  text(
    'Sau cọc, hai bên duyệt phụ lục cho thay đổi đã thống nhất về ngày, ca hoặc hạng mục thương mại. Phụ lục được đối soát khi tất toán. Đơn đặt in thiệp, nếu có, được thỏa thuận qua phụ lục sau cọc.',
  );

  section('Điều 7. Đổi ngày, hủy tiệc và xử lý cọc');
  text(
    'Bên B báo đổi trước từ 30 ngày được đổi 01 lần và chuyển toàn bộ tiền cọc sang ca còn trống do hai bên thống nhất, trong vòng 90 ngày kể từ ngày tiệc ban đầu. Báo dưới 30 ngày, hai bên xem xét theo lịch trống và mức độ chuẩn bị. Giữ ngày cũ đến khi hai bên xác nhận ngày mới. Chênh lệch giá ghi trong phụ lục.',
  );
  text(
    'Khi Bên B hủy vì lý do cá nhân, kể cả sau khi không thống nhất được ngày mới, tính mức hoàn trên tiền cọc thực nhận. Thời hạn tính từ lúc hệ thống nhận yêu cầu hủy đến giờ bắt đầu ca, mỗi ngày tương ứng 24 giờ.',
  );
  text(
    'Từ 30 ngày: hoàn 100%. Từ 07 đến dưới 30 ngày: hoàn 50%. Dưới 07 ngày và trước giờ bắt đầu ca: hoàn 0%.',
    true,
  );
  text(
    'Nếu hợp đồng chấm dứt do Bên A từ chối thực hiện nghĩa vụ được bảo đảm bằng cọc, Bên A hoàn cọc và trả thêm khoản bằng tiền cọc thực nhận. Bên B có thể đồng ý phương án thay thế.',
  );
  text(
    'Bên A thông báo kết quả, lưu chứng từ và hoàn tiền trong 07 ngày làm việc kể từ khi xác nhận số tiền hoàn và có đủ thông tin nhận hoàn.',
  );

  section('Điều 8. Bất khả kháng');
  text(
    'Bên bị ảnh hưởng thông báo sớm và cung cấp căn cứ. Nếu sự kiện khiến tiệc không thể tổ chức, hai bên ưu tiên đổi ngày và chuyển toàn bộ cọc. Nếu không thống nhất được ngày mới, Bên A hoàn toàn bộ cọc tiệc. Hạng mục độc lập đã được duyệt và bàn giao được đối soát riêng theo phụ lục.',
  );

  section('Điều 9. Giải quyết tranh chấp');
  text(
    'Hai bên ưu tiên thương lượng. Mỗi bên có quyền yêu cầu cơ quan có thẩm quyền giải quyết theo pháp luật Việt Nam.',
  );
}
