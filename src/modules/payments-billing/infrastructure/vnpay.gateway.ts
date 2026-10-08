import type { VnpayStatusGateway } from '../application/vnpay.port.js';
import { VNPAY_QUERY_URL } from './vnpay.protocol.js';

// No implicit retries or alternative endpoint. An unavailable response is not proof of failure.
export function createVnpayStatusGateway(
  transport: typeof fetch = fetch,
  timeoutMs = 5000,
): VnpayStatusGateway {
  return Object.freeze({
    async query(request: Readonly<Record<string, string>>) {
      const response = await transport(VNPAY_QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok || response.body === null) throw new Error('VNPay status is unavailable.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 16384) {
            await reader.cancel();
            throw new Error('VNPay status exceeded the response limit.');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return decoded;
    },
  });
}
