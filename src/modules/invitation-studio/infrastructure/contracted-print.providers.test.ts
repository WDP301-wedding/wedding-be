import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createContractedPrintFulfillment } from './contracted-print.providers.js';
it('refuses fulfillment when the billing owner has no original contract obligation', async () => {
  const client = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    billingLedgerEntry: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  await expect(
    createContractedPrintFulfillment().owners.contractObligation(client, randomUUID()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
