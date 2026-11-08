import { createHash, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { documentDigest, type ContractView } from '../domain/commercial-contract.js';
import { renderContractPdf } from './contract-pdf.renderer.js';
function fixture(state: ContractView['state'] = 'DRAFT'): ContractView {
  const document = commercialDocumentFixture();
  return {
    revisionId: randomUUID(),
    revisionNumber: 1,
    predecessorRevisionId: null,
    state,
    document,
    documentDigest: documentDigest(document),
    createdAt: '2026-10-11T00:00:00.000Z',
    submittedAt: null,
    approvedAt: null,
    approvals: [],
    pdfSha256: null,
  };
}
afterEach(() => vi.restoreAllMocks());
describe('private Vietnamese contract PDF output', () => {
  it('prints the frozen incidental price and counting rule without adding it to the contract or deposit', async () => {
    const view = fixture();
    const before = {
      total: view.document.contractTotalVnd,
      deposit: view.document.depositAmountVnd,
    };
    view.document.incidentalPricing = [
      {
        offeringId: randomUUID(),
        revision: 1,
        name: 'Bia A',
        description: 'Thùng 24 lon × 330 ml',
        unit: 'thùng',
        unitPriceVnd: 300000,
        chargingRule: 'Chỉ tính thùng đã mở',
      },
    ];
    view.document.incidentalApprovalRequired = true;
    const rendered = vi.spyOn(PDFDocument.prototype, 'text');
    await renderContractPdf(view);
    const output = rendered.mock.calls.map(([value]) => value).join('\n');
    expect(output).toContain('Bảng đơn giá áp dụng khi phát sinh');
    expect(output).toContain('Bia A — 300.000 đ/thùng');
    expect(output).toContain('Chỉ tính thùng đã mở');
    expect(output).toContain('hai bên duyệt cùng bảng chi phí');
    expect(view.document.contractTotalVnd).toBe(before.total);
    expect(view.document.depositAmountVnd).toBe(before.deposit);
  });
  it.each([10, 50, 100])(
    'prints the frozen %i%% policy in the contract and settlement clause',
    async (rate) => {
      const view = fixture();
      view.document.depositRate = rate;
      view.document.depositAmountVnd = Math.ceil((view.document.contractTotalVnd * rate) / 100);
      const rendered = vi.spyOn(PDFDocument.prototype, 'text');
      await renderContractPdf(view);
      expect(rendered.mock.calls.map(([value]) => value).join('\n')).toContain(
        `Tiền đặt cọc cam kết (${rate}%):`,
      );
      view.document.standardTerms = {
        version: 'WEDDING_STANDARD_V1',
        reserveMenu: { versionId: randomUUID(), name: 'Menu', dishes: ['Món'] },
        orderedMenus: [],
      };
      rendered.mockClear();
      await renderContractPdf(view);
      const output = rendered.mock.calls.map(([value]) => value).join('\n');
      expect(output).toContain(`5.1. Đặt cọc ${rate}%:`);
      expect(output).toContain(
        (view.document.contractTotalVnd - view.document.depositAmountVnd).toLocaleString('vi-VN'),
      );
    },
  );
  it.each(['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'SUPERSEDED'] as const)(
    'renders %s identity with exact byte digest',
    async (state) => {
      const v = fixture(state);
      v.document.brideName = null;
      v.document.groomName = null;
      v.document.shiftCode = 'LUNCH';
      v.submittedAt = '2026-10-11T00:01:00.000Z';
      const result = await renderContractPdf(v);
      expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.sha256).toBe(createHash('sha256').update(result.bytes).digest('hex'));
    },
  );
  it('paginates long itemized menu/print/service content', async () => {
    const v = fixture();
    const base = v.document.lines[0]!;
    v.document.lines = Array.from({ length: 30 }, (_, i) => ({
      ...base,
      sourceId: randomUUID(),
      sourceRevisionId: randomUUID(),
      category: i % 3 === 0 ? 'MENU' : i % 3 === 1 ? 'PRINT' : 'SERVICE',
      unit: i % 3 === 0 ? 'table' : i % 3 === 1 ? 'copy' : 'buổi',
      description: 'Nội dung thỏa thuận dài. '.repeat(30),
    }));
    v.document.timeline[0]!.description = 'Lịch trình chi tiết';
    const result = await renderContractPdf(v);
    expect(result.bytes.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(2);
  });
  it('prints the frozen standard terms and two handwritten signature areas', async () => {
    const view = fixture('AWAITING_APPROVAL');
    Object.assign(view.document, {
      standardTerms: {
        version: 'WEDDING_STANDARD_V1',
        reserveMenu: { versionId: randomUUID(), name: 'Gói Sen', dishes: ['Súp bắp'] },
        orderedMenus: [],
      },
    });
    const rendered = vi.spyOn(PDFDocument.prototype, 'text');
    await renderContractPdf(view);
    const output = rendered.mock.calls.map(([value]) => value).join('\n');
    for (const text of [
      'Bản xem trước',
      'đã bao gồm thuế GTGT',
      '02 bàn dự phòng',
      'Gói Sen',
      'Súp bắp',
      'Tất toán sau tiệc',
      '24.500.000',
      'Điều 10.',
      'ĐẠI DIỆN BÊN A',
      'ĐẠI DIỆN BÊN B',
      'Ký, ghi rõ họ tên',
    ])
      expect(output).toContain(text);
  });
  it('rejects an oversized emitted document instead of returning it', async () => {
    const prototype = PDFDocument.prototype as InstanceType<typeof PDFDocument>;
    const original = Reflect.get(prototype, 'end');
    vi.spyOn(prototype, 'end').mockImplementation(function (
      this: InstanceType<typeof PDFDocument>,
    ) {
      this.emit('data', Buffer.alloc(8 * 1024 * 1024 + 1));
      return original.call(this);
    });
    await expect(renderContractPdf(fixture())).rejects.toThrow(
      'Contract PDF exceeds the output limit.',
    );
  });
});
