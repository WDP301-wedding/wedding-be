import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client.js';
import { retryCommercialWrite } from './commercial-write.retry.js';
const serialization = () =>
  new Prisma.PrismaClientKnownRequestError('Serialization conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
describe('commercial transaction retries', () => {
  it('starts a fresh whole command after rollback and returns its result', async () => {
    const work = vi
      .fn()
      .mockRejectedValueOnce(serialization())
      .mockRejectedValueOnce(serialization())
      .mockResolvedValue('fresh');
    await expect(retryCommercialWrite(work)).resolves.toBe('fresh');
    expect(work).toHaveBeenCalledTimes(3);
  });
  it('bounds retries and returns a terminal revision conflict instead of an unknown 500', async () => {
    const work = vi.fn().mockRejectedValue(serialization());
    await expect(retryCommercialWrite(work)).rejects.toMatchObject({
      status: 409,
      code: 'CONTRACT_REVISION_STALE',
    });
    expect(work).toHaveBeenCalledTimes(3);
  });
  it.each([
    new Error('Unavailable'),
    new Prisma.PrismaClientKnownRequestError('Unique conflict', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  ])('does not retry unrelated errors', async (error) => {
    const work = vi.fn().mockRejectedValue(error);
    await expect(retryCommercialWrite(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
