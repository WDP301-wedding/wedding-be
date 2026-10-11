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
