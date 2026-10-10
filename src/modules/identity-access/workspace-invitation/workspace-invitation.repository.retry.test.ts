import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  ActiveInvitationExistsError,
  createPrismaWorkspaceInvitationRepository,
  InvitationNotFoundError,
  InvitationReissueLimitError,
  type AcceptInvitationInput,
  type PersistInvitationInput,
} from './workspace-invitation.repository.js';

const now = new Date('2026-10-10T00:00:00Z');
const issuance: PersistInvitationInput = {
  consultationId: 'consultation',
  recipientEmailNormalized: 'fixture@example.test',
  issuedByAccountId: 'operator',
  tokenHash: 'a'.repeat(43),
  expiresAt: new Date('2026-10-13T00:00:00Z'),
  now,
  requestId: 'request',
  reissueLimit: 3,
  reissueWindowSeconds: 86_400,
};
const acceptance: AcceptInvitationInput = {
  invitationTokenHash: issuance.tokenHash,
  expectedAccountId: null,
  expectedPasswordUpdatedAt: null,
  newAccountPasswordVerifier: null,
  accessTokenHash: 'b'.repeat(43),
  refreshTokenHash: 'c'.repeat(43),
  accessExpiresAt: issuance.expiresAt,
  idleExpiresAt: issuance.expiresAt,
  absoluteExpiresAt: issuance.expiresAt,
  now,
  requestId: issuance.requestId,
};

function databaseError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('controlled database failure', {
    code,
    clientVersion: '7.10.0',
  });
}

type Operation = 'issue' | 'reissue' | 'accept';
function fixture(operation: Operation) {
  const transaction = vi.fn();
  const repository = createPrismaWorkspaceInvitationRepository({
    $transaction: transaction,
  } as unknown as PrismaClient);
  return {
    transaction,
    execute: () =>
      operation === 'accept' ? repository.accept(acceptance) : repository[operation](issuance),
  };
}

describe('workspace invitation transaction failure contract', () => {
  // Real concurrent integration tests still prove persistence. Inject conflicts
  // here so retry/denial coverage never depends on which database race wins.
  describe.each<Operation>(['issue', 'reissue', 'accept'])('%s', (operation) => {
    it('recovers after two serialization conflicts within the retry budget', async () => {
      const { transaction, execute } = fixture(operation);
      const result = operation === 'accept' ? null : { invitationId: 'durable', sequence: 1 };
      transaction
        .mockRejectedValueOnce(databaseError('P2034'))
        .mockRejectedValueOnce(databaseError('P2034'))
        .mockResolvedValueOnce(result);

      await expect(execute()).resolves.toEqual(result);
      expect(transaction).toHaveBeenCalledTimes(3);
      for (const call of transaction.mock.calls) {
        expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      }
    });

    it('propagates an exhausted serialization conflict instead of retrying indefinitely', async () => {
      const { transaction, execute } = fixture(operation);
      const failure = databaseError('P2034');
      transaction.mockRejectedValue(failure);

      await expect(execute()).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(3);
    });

    it('does not retry or conceal an unrelated database failure', async () => {
      const { transaction, execute } = fixture(operation);
      const failure = new Error('controlled unavailable connection');
      transaction.mockRejectedValue(failure);

      await expect(execute()).rejects.toBe(failure);
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  it.each<Operation>(['issue', 'reissue'])(
    'maps a unique conflict during %s to the active-invitation denial without retries',
    async (operation) => {
      const { transaction, execute } = fixture(operation);
      transaction.mockRejectedValue(databaseError('P2002'));

      await expect(execute()).rejects.toBeInstanceOf(ActiveInvitationExistsError);
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );

  it('denies acceptance after exhausting unique-conflict retries', async () => {
    const { transaction, execute } = fixture('accept');
    transaction.mockRejectedValue(databaseError('P2002'));

    await expect(execute()).resolves.toBeNull();
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    new ActiveInvitationExistsError(),
    new InvitationNotFoundError(),
    new InvitationReissueLimitError(),
  ])('preserves the domain denial $name without retrying', async (failure) => {
    const { transaction, execute } = fixture('reissue');
    transaction.mockRejectedValue(failure);

    await expect(execute()).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
