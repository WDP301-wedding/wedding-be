import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createVnpayService } from './vnpay.service.js';
import { VnpayProtocolError } from './vnpay.port.js';

describe('VNPay callback boundary', () => {
  it('acknowledges invalid signature without looking up an order or trusting roles', async () => {
    const evidence = { findAttemptBooking: vi.fn() };
    const protocol = {
      verifyIpn: vi.fn(() => {
        throw new VnpayProtocolError('SIGNATURE');
      }),
    };
    // This path intentionally cannot reach any persistence or booking owner.
    const service = createVnpayService({ protocol, evidence } as unknown as Parameters<
      typeof createVnpayService
    >[0]);
    expect(await service.processIpn('untrusted')).toEqual({
      RspCode: '97',
      Message: 'Invalid signature',
    });
    expect(evidence.findAttemptBooking).not.toHaveBeenCalled();
  });
  it('does not acknowledge persistence failure as durable success', async () => {
    const service = createVnpayService({
      protocol: { verifyIpn: () => ({ paymentAttemptId: randomUUID() }) },
      evidence: { findAttemptBooking: () => Promise.resolve(randomUUID()) },
      boundary: {
        run: () => Promise.reject(new Error('storage unavailable')),
      },
    } as unknown as Parameters<typeof createVnpayService>[0]);
    expect(await service.processIpn('signed')).toEqual({
      RspCode: '99',
      Message: 'Processing failure',
    });
  });
});
