import { describe, expect, it } from 'vitest';
import {
  isWindowOpen,
  configurationInput,
  undoInput,
  checkInInput,
  reason,
} from './staff-policy.js';
describe('Named Guest operations policy', () => {
  it('uses Asia/Saigon instants and inclusive start-2h/end+12h boundaries', () => {
    const open = (instant: string) =>
      isWindowOpen(new Date(instant), '2026-10-12', '11:00', '14:00');
    expect(open('2026-10-12T01:59:59.999Z')).toBe(false);
    expect(open('2026-10-12T02:00:00.000Z')).toBe(true);
    expect(open('2026-10-12T19:00:00.000Z')).toBe(true);
    expect(open('2026-10-12T19:00:00.001Z')).toBe(false);
  });
  it('normalizes bounded correction reasons and rejects undeclared attendance authorities', () => {
    expect(reason.parse('  Sửa ghi nhận nhầm  ')).toBe('Sửa ghi nhận nhầm');
    expect(
      configurationInput.safeParse({ checkInMode: 'BY_GUEST_NAME', expectedRevision: 0 }).success,
    ).toBe(false);
    expect(checkInInput.safeParse({ role: 'MANAGER' }).success).toBe(false);
    expect(
      undoInput.safeParse({
        checkInRecordId: 'invalid',
        expectedLedgerRevision: 1,
        reason: 'short',
      }).success,
    ).toBe(false);
  });
});
