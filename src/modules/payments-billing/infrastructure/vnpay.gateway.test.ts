import { describe, expect, it, vi } from 'vitest';

import { createVnpayStatusGateway } from './vnpay.gateway.js';
import { VNPAY_QUERY_URL } from './vnpay.protocol.js';

describe('controlled VNPay transport', () => {
  it('posts JSON only to the fixed sandbox querydr endpoint with an abort deadline', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{"vnp_ResponseCode":"91"}'));
    const gateway = createVnpayStatusGateway(transport);
    expect(await gateway.query({ vnp_Command: 'querydr' })).toEqual({ vnp_ResponseCode: '91' });
    expect(transport).toHaveBeenCalledWith(
      VNPAY_QUERY_URL,
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        body: '{"vnp_Command":"querydr"}',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    new Response('failure', { status: 503 }),
    new Response('malformed'),
    new Response('x'.repeat(16385)),
    new Response(null),
  ])('rejects HTTP, parse, body-limit and missing-body failures', async (response) => {
    await expect(createVnpayStatusGateway(async () => response).query({})).rejects.toThrow();
  });
  it('propagates timeout as unavailable evidence, never a terminal provider failure', async () => {
    const transport: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('controlled timeout')), {
          once: true,
        });
      });
    await expect(createVnpayStatusGateway(transport, 20).query({})).rejects.toThrow(
      'controlled timeout',
    );
  });
});
