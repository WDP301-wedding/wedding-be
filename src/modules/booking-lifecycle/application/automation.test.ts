import { describe, expect, it, vi } from 'vitest';
import { createBookingAutomationPort, type BookingAutomationPort } from './automation.js';

describe('booking worker authority', () => {
  const context = {
    requestId: '00000000-0000-4000-8000-000000000001',
    causationId: '00000000-0000-4000-8000-000000000002',
    actorAccountId: null,
    authority: 'SYSTEM' as const,
  };
  const input = { kind: 'COMPLETION' as const, dueBefore: '2026-10-08T00:00:00.000Z', limit: 100 };
  it('requires the configured allowlist before dispatching either worker command', async () => {
    const repository: BookingAutomationPort = { listDue: vi.fn(), completeDue: vi.fn() };
    const authorize = vi.fn().mockRejectedValue(new Error('not allowlisted'));
    const port = createBookingAutomationPort(repository, authorize);
    await expect(port.listDue(input, context)).rejects.toThrow('not allowlisted');
    await expect(
      port.listDue(input, { ...context, actorAccountId: 'account', authority: 'AUTHENTICATED' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalledTimes(1);
  });
  it('validates worker limits and delegates approved commands', async () => {
    const repository: BookingAutomationPort = {
      listDue: vi.fn().mockResolvedValue({ nextCursor: null, items: [] }),
      completeDue: vi.fn().mockResolvedValue({ outcome: 'COMPLETED' }),
    };
    const port = createBookingAutomationPort(repository, async () => {});
    await expect(port.listDue({ ...input, limit: 501 }, context)).rejects.toThrow();
    await expect(port.listDue(input, context)).resolves.toEqual({ nextCursor: null, items: [] });
    await expect(
      port.completeDue(
        {
          bookingId: context.requestId,
          commandId: context.causationId,
          expectedBookingRevision: 1,
          now: input.dueBefore,
        },
        context,
      ),
    ).resolves.toMatchObject({ outcome: 'COMPLETED' });
  });
});
