import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  groupWriteSchema,
  guestWriteSchema,
  importRowsSchema,
  normalizeGroupName,
  planWriteSchema,
} from './guest-policy.js';

describe('Guest boundaries', () => {
  it('normalizes group uniqueness and preserves separate named identities', () => {
    expect(normalizeGroupName('  Ｆｒｉｅｎｄｓ ')).toBe('friends');
    expect(normalizeGroupName('Straße')).toBe(normalizeGroupName('STRASSE'));
    expect(normalizeGroupName('σ')).toBe(normalizeGroupName('ς'));
    expect(normalizeGroupName('ı')).not.toBe(normalizeGroupName('I'));
    expect(groupWriteSchema.parse({ name: '  Bạn bè ', color: '#abcdef' })).toEqual({
      name: 'Bạn bè',
      color: '#ABCDEF',
    });
    expect(guestWriteSchema.parse({ name: '  Nguyễn An ', guestGroupId: randomUUID() }).name).toBe(
      'Nguyễn An',
    );
  });
  it('rejects inferred quantities, unknown fields, invalid phones and fractional totals', () => {
    expect(
      guestWriteSchema.safeParse({ name: 'An', guestGroupId: randomUUID(), expectedAttendees: 2 })
        .success,
    ).toBe(false);
    expect(
      guestWriteSchema.safeParse({ name: 'An', guestGroupId: randomUUID(), phone: '0901234567' })
        .success,
    ).toBe(false);
    expect(planWriteSchema.safeParse({ expectedRevision: 1, planningHeadcount: 2.5 }).success).toBe(
      false,
    );
    expect(
      planWriteSchema.parse({ expectedRevision: 1, planningHeadcount: 0 }).planningHeadcount,
    ).toBe(0);
  });
  it('requires stable unique row keys, rejects formulas and limits batches', () => {
    const row = { externalRowKey: '1', name: 'An', guestGroupId: randomUUID() };
    expect(importRowsSchema.safeParse([row, row]).success).toBe(false);
    expect(importRowsSchema.safeParse([{ ...row, name: '=SUM(1,2)' }]).success).toBe(false);
    expect(importRowsSchema.parse([row, { ...row, externalRowKey: '2' }])).toHaveLength(2);
    expect(
      importRowsSchema.safeParse(
        Array.from({ length: 1001 }, (_, i) => ({ ...row, externalRowKey: String(i) })),
      ).success,
    ).toBe(false);
  });
});
