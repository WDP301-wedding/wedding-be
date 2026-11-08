import { describe, it, expect } from 'vitest';
import { requireExpenseApproval } from './incidental-approval.js';

describe('current incidental approval before settlement', () => {
  const review = {
    type: 'EXPENSES',
    state: 'APPROVED',
    draftRevision: 4,
    managerAccountId: 'manager',
    coupleAccountId: 'couple',
    coupleApprovedAt: new Date(),
  };
  it('blocks missing, stale, one-party and withdrawn approval', () => {
    for (const value of [
      null,
      { ...review, state: 'AWAITING_APPROVAL' },
      { ...review, draftRevision: 3 },
      { ...review, coupleApprovedAt: null },
      { ...review, state: 'WITHDRAWN' },
      { ...review, coupleAccountId: 'manager' },
    ]) {
      expect(() => requireExpenseApproval(1, 4, 100, value)).toThrow();
    }
  });
  it('accepts exact bilateral approval or explicit empty declaration', () => {
    expect(() => requireExpenseApproval(1, 4, 100, review)).not.toThrow();
    expect(() =>
      requireExpenseApproval(1, 4, 0, {
        ...review,
        type: 'NONE',
        coupleAccountId: null,
        coupleApprovedAt: null,
      }),
    ).not.toThrow();
    expect(() => requireExpenseApproval(1, 4, 100, { ...review, type: 'NONE' })).toThrow();
  });
  it('retains legacy settlement rules', () => {
    expect(() => requireExpenseApproval(null, 4, 100, null)).not.toThrow();
  });
});
