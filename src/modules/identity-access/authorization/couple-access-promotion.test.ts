import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../../../core/errors/app-error.js';
import {
  createCoupleAccessPromoter,
  type CoupleAccessPromotionRepository,
  type PromotionInput,
  type PromotionRepositoryOutcome,
} from './couple-access-promotion.js';

class FakePromotionRepository implements CoupleAccessPromotionRepository {
  inputs: PromotionInput[] = [];
  outcome: PromotionRepositoryOutcome = {
    outcome: 'PROMOTED',
    accessId: randomUUID(),
  };

  promote(input: PromotionInput): Promise<PromotionRepositoryOutcome> {
    this.inputs.push(input);
    return Promise.resolve(this.outcome);
  }
}

describe('IA-12 Couple access promotion port', () => {
  it('promotes from evidence identifiers without accepting a caller-selected level', async () => {
    const repository = new FakePromotionRepository();
    const promoter = createCoupleAccessPromoter(repository);
    const input = {
      accountId: randomUUID(),
      consultationId: randomUUID(),
      sourcePaymentId: randomUUID(),
      requestId: randomUUID(),
    };

    await expect(promoter.promote(input)).resolves.toMatchObject({
      level: 'FULL',
      replayed: false,
    });
    expect(repository.inputs).toEqual([input]);
    expect(repository.inputs[0]).not.toHaveProperty('level');
  });

  it('returns an idempotent exact replay and maps payment reuse to a stable conflict', async () => {
    const repository = new FakePromotionRepository();
    const promoter = createCoupleAccessPromoter(repository);
    const input = {
      accountId: randomUUID(),
      consultationId: randomUUID(),
      sourcePaymentId: randomUUID(),
      requestId: randomUUID(),
    };

    repository.outcome = { outcome: 'REPLAYED', accessId: randomUUID() };
    await expect(promoter.promote(input)).resolves.toMatchObject({
      level: 'FULL',
      replayed: true,
    });

    repository.outcome = { outcome: 'CONFLICT' };
    await expect(promoter.promote(input)).rejects.toBeInstanceOf(ConflictError);

    repository.outcome = { outcome: 'NOT_FOUND' };
    await expect(promoter.promote(input)).rejects.toBeInstanceOf(NotFoundError);
  });
});
