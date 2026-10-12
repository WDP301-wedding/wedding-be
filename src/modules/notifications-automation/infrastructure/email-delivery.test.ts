import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NotificationEmailDelivery } from './email-delivery.js';
import { createEmailIntentIdempotencyKey } from '../../../integrations/email/email-provider.js';
import { BrevoEmailProvider } from '../../../integrations/email/brevo-email-provider.js';

describe('notification email acceptance and delivery proof', () => {
  const config = {
    enabled: true as const,
    provider: 'brevo' as const,
    apiKey: 'test-only',
    fromEmail: 'sender@example.invalid',
  };
  const command = () => ({
    idempotencyKey: createEmailIntentIdempotencyKey({
      intentType: 'notification-email-v1',
      entityId: randomUUID(),
    }),
    subject: 'Thông báo thử',
    text: 'Booking reference only',
    to: ['authorized@example.invalid'],
  });
  it.each([
    [429, 'RETRYABLE_FAILED'],
    [401, 'DEAD_LETTER'],
    [403, 'DEAD_LETTER'],
    [500, 'UNKNOWN'],
    [400, 'UNKNOWN'],
    [408, 'UNKNOWN'],
  ] as const)(
    'classifies actual provider rejection %s without retrying an ambiguous send',
    async (status, outcome) => {
      const provider = new BrevoEmailProvider({
        apiKey: 'controlled',
        fromEmail: 'sender@example.invalid',
        fetch: vi.fn(() => Promise.resolve(new Response('private-response-body', { status }))),
      });
      const result = await new NotificationEmailDelivery(config, provider).send(command());
      expect(result.outcome).toBe(outcome);
      expect(JSON.stringify(result)).not.toContain('private-response-body');
    },
  );
  it('treats send acknowledgement as ACCEPTED and an ambiguous failure as UNKNOWN', async () => {
    const c = command();
    const s = new NotificationEmailDelivery(config, {
      send: () => Promise.resolve({ idempotencyKey: c.idempotencyKey, messageId: 'receipt-1' }),
    });
    expect(await s.send(c)).toEqual({ outcome: 'ACCEPTED', providerMessageId: 'receipt-1' });
    const failed = new NotificationEmailDelivery(config, {
      send: () => Promise.reject(Error('private-password-and-provider-body')),
    });
    const result = await failed.send(c);
    expect(result.outcome).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
  it('requires the same message ID and an actual delivery event', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [
            { messageId: 'another-receipt', event: 'delivered' },
            { messageId: 'receipt-1', event: 'requests' },
          ],
        }),
        { status: 200 },
      ),
    );
    const s = new NotificationEmailDelivery(config, undefined, fetcher);
    expect((await s.reconcile('receipt-1')).outcome).toBe('UNKNOWN');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ events: [{ messageId: 'receipt-1', event: 'delivered' }] }), {
        status: 200,
      }),
    );
    expect(await s.reconcile('receipt-1')).toEqual({
      outcome: 'DELIVERED',
      providerMessageId: 'receipt-1',
    });
    expect(String(fetcher.mock.calls[0]![0])).toContain('messageId=receipt-1');
  });
  it('fails closed for unconfigured channels, malformed replies and contradictory evidence', async () => {
    const disabled = new NotificationEmailDelivery({ enabled: false });
    expect((await disabled.send(command())).outcome).toBe('DEAD_LETTER');
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const s = new NotificationEmailDelivery(config, undefined, fetcher);
    expect((await s.reconcile('receipt-1')).outcome).toBe('UNKNOWN');
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          events: [
            { messageId: 'receipt-1', event: 'delivered' },
            { messageId: 'receipt-1', event: 'hardBounces' },
          ],
        }),
        { status: 200 },
      ),
    );
    expect((await s.reconcile('receipt-1')).outcome).toBe('UNKNOWN');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ events: [{ messageId: 'receipt-1', event: 'blocked' }] }), {
        status: 200,
      }),
    );
    expect((await s.reconcile('receipt-1')).outcome).toBe('DEAD_LETTER');
    fetcher.mockRejectedValueOnce(Error('private-network-detail'));
    expect((await s.reconcile('receipt-1')).outcome).toBe('UNKNOWN');
  });
});
