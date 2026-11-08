import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import { contractResponseSchema } from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import { proposalResponseSchema } from '../../src/modules/booking-lifecycle/http/booking-lifecycle.responses.js';

export function registerDepositPolicyCases(h: StepSixApiHarness) {
  it('serializes a new booking against an in-flight Manager policy change without an HTTP 500', async () => {
    const prisma = h.database.prisma;
    const profile = await prisma.restaurantProfile.findUniqueOrThrow({
      where: { singletonKey: 'RESTAURANT' },
    });
    let release: () => void = () => undefined;
    let locked: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const config = prisma.$transaction(
      async (tx) => {
        await tx.restaurantProfile.update({
          where: { id: profile.id },
          data: { depositPercentage: 50, revision: { increment: 1 } },
        });
        locked();
        await gate;
      },
      { timeout: 10000 },
    );
    let creating: ReturnType<typeof h.fixture> | undefined;
    try {
      await ready;
      creating = h.fixture();
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const rows = await prisma.$queryRaw<
          { blocked: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
        blocked = rows[0]!.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      release();
      await config;
      const f = await creating;
      expect(await prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({
        depositPercentage: 50,
      });
    } finally {
      release();
      await config;
      await creating?.catch(() => undefined);
      await prisma.restaurantProfile.update({
        where: { id: profile.id },
        data: { depositPercentage: profile.depositPercentage, revision: { increment: 1 } },
      });
    }
  }, 60000);
  it('freezes new-booking policy across configuration changes, approvals and real deposit recording', async () => {
    const prisma = h.database.prisma;
    const initial = await prisma.restaurantProfile.findUniqueOrThrow({
      where: { singletonKey: 'RESTAURANT' },
    });
    const old = await h.fixture();
    try {
      await prisma.restaurantProfile.update({
        where: { id: initial.id },
        data: { depositPercentage: 50, revision: { increment: 1 } },
      });
      const newer = await h.fixture();
      await prisma.restaurantProfile.update({
        where: { id: initial.id },
        data: { depositPercentage: 100, revision: { increment: 1 } },
      });
      const newest = await h.fixture();
      for (const [f, rate] of [
        [old, 30],
        [newer, 50],
        [newest, 100],
      ] as const) {
        const row = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
        expect(row.depositPercentage).toBe(rate);
        const proposal = proposalResponseSchema.parse(
          (await h.get(`/bookings/${f.id}/proposal`)).body as unknown,
        ).data.proposal;
        expect(proposal.depositPercentage).toBe(rate);
        expect(proposal.depositAmountVnd).toBe(Math.ceil((proposal.baseChargeVnd * rate) / 100));
        const approved = await h.approved(f);
        const document = approved.contract.document;
        expect(document.depositRate).toBe(rate);
        expect(document.depositAmountVnd).toBe(Math.ceil((document.contractTotalVnd * rate) / 100));
        const response = await h.post('/management/billing/payments/manual', {
          bookingId: f.id,
          purpose: 'DEPOSIT',
          contractRevisionId: approved.contract.revisionId,
          documentDigest: approved.contract.documentDigest,
          amountVnd: document.depositAmountVnd,
          settledAt: new Date().toISOString(),
          reason: 'Local policy acceptance',
          evidenceReference: randomUUID(),
        });
        expect(response.status).toBe(201);
        expect((await h.get(f.path)).status).toBe(200);
        const stored =
          contractResponseSchema.shape.data.shape.contract.shape.document.parse(document);
        expect(stored.depositRate).toBe(rate);
      }
      await expect(
        prisma.booking.update({ where: { id: old.id }, data: { depositPercentage: 60 } }),
      ).rejects.toThrow();
    } finally {
      await prisma.restaurantProfile.update({
        where: { id: initial.id },
        data: { depositPercentage: initial.depositPercentage, revision: { increment: 1 } },
      });
    }
  }, 60000);
}
