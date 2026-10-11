import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { commercialDocumentFixture } from '../../../../tests/fixtures/commercial-contract.js';
import { documentDigest } from '../../booking-lifecycle/domain/commercial-contract.js';
import type { BillingLedgerRepository, LedgerEntry } from './billing-ledger.port.js';
import { registerContractCharge } from './contract-charge.service.js';
function fixture(entries: LedgerEntry[] = []) {
  const document = commercialDocumentFixture();
  const snapshot = {
    bookingId: document.bookingId,
    contractRevisionId: randomUUID(),
    timelineRevisionId: document.timelineRevisionId,
    documentDigest: documentDigest(document),
    contractTotalVnd: document.contractTotalVnd,
    depositAmountVnd: document.depositAmountVnd,
    approvedAt: '2026-10-11T00:00:00.000Z',
    document,
  };
  const ledger = {
    getLedger: vi.fn<BillingLedgerRepository['getLedger']>().mockResolvedValue({
      revision: entries.length,
      entries,
      totals: {
        acceptedChargesVnd: 0,
        paidVnd: 0,
        refundedVnd: 0,
        netPaidVnd: 0,
        outstandingVnd: 0,
        creditVnd: 0,
      },
    }),
    append: vi
      .fn<BillingLedgerRepository['append']>()
      .mockImplementation((input) =>
        Promise.resolve({ entry: { ...input, revision: 1 }, replayed: false }),
      ),
  };
  const context = {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: randomUUID(),
    authority: 'AUTHENTICATED' as const,
  };
  return { snapshot, ledger, context };
}
describe('once-only contract charge registration', () => {
  it('passes exact approved amount, source identity and time to the ledger', async () => {
    const f = fixture();
    const r = await registerContractCharge(f.ledger, f.snapshot, f.context);
    expect(r.entry).toMatchObject({
      kind: 'CHARGE',
      sourceType: 'CONTRACT',
      amountVnd: 35000000,
      sourceRevisionId: f.snapshot.contractRevisionId,
      occurredAt: f.snapshot.approvedAt,
    });
    expect(f.ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: f.snapshot.bookingId }),
      f.context,
    );
  });
  it.each(['BASE_BOOKING', 'PRINT_ORDER', 'CONTRACT'] as const)(
    'rejects incompatible %s obligations before append',
    async (sourceType) => {
      const f = fixture();
      const entry: LedgerEntry = {
        id: randomUUID(),
        bookingId: f.snapshot.bookingId,
        revision: 1,
        kind: 'CHARGE',
        sourceType,
        sourceRevisionId: randomUUID(),
        amountVnd: 1,
        occurredAt: f.snapshot.approvedAt,
        sourceEntryId: null,
        paymentAttemptId: null,
        decisionId: null,
        approvedRefundableVnd: null,
        reason: null,
        evidenceReference: null,
      };
      f.ledger.getLedger.mockResolvedValue({
        revision: 1,
        entries: [entry],
        totals: {
          acceptedChargesVnd: 1,
          paidVnd: 0,
          refundedVnd: 0,
          netPaidVnd: 0,
          outstandingVnd: 1,
          creditVnd: 0,
        },
      });
      await expect(registerContractCharge(f.ledger, f.snapshot, f.context)).rejects.toMatchObject({
        code: 'FINANCIAL_SOURCE_CONFLICT',
      });
      expect(f.ledger.append).not.toHaveBeenCalled();
    },
  );
  it('delegates replay of the same contract source to the ledger', async () => {
    const f = fixture(),
      first = await registerContractCharge(f.ledger, f.snapshot, f.context);
    f.ledger.getLedger.mockResolvedValue({
      revision: 1,
      entries: [first.entry],
      totals: {
        acceptedChargesVnd: 35000000,
        paidVnd: 0,
        refundedVnd: 0,
        netPaidVnd: 0,
        outstandingVnd: 35000000,
        creditVnd: 0,
      },
    });
    f.ledger.append.mockResolvedValue({ entry: first.entry, replayed: true });
    await expect(registerContractCharge(f.ledger, f.snapshot, f.context)).resolves.toEqual({
      entry: first.entry,
      replayed: true,
    });
  });
});
