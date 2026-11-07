import { describe, expect, it } from 'vitest';
import { completionAppendix } from './completion-appendix.js';

describe('completion appendix evidence', () => {
  const revision = {
    state: 'APPROVED',
    revisionNumber: 3,
    documentDigest: 'current',
    approvals: [
      { party: 'MANAGER', documentDigest: 'current' },
      { party: 'COUPLE', documentDigest: 'current' },
    ],
  };
  it('allows no appendix, superseded history, and same-digest dual approval', () => {
    expect(completionAppendix(null).pending).toBe(false);
    expect(completionAppendix({ ...revision, state: 'SUPERSEDED', approvals: [] }).pending).toBe(
      false,
    );
    expect(completionAppendix(revision).pending).toBe(false);
  });
  it.each(['DRAFT', 'AWAITING_APPROVAL'])('blocks %s even for a zero-price change', (state) => {
    expect(completionAppendix({ ...revision, state }).pending).toBe(true);
  });
  it('requires both approvals for this exact revision digest', () => {
    expect(
      completionAppendix({ ...revision, approvals: revision.approvals.slice(0, 1) }).pending,
    ).toBe(true);
    expect(
      completionAppendix({
        ...revision,
        approvals: [revision.approvals[0]!, { party: 'COUPLE', documentDigest: 'old' }],
      }).pending,
    ).toBe(true);
  });
});
