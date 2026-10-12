import { z } from 'zod';
import type { BackendConfig } from '../../../config/env.js';
import { createEmailProvider } from '../../../integrations/email/email-provider.factory.js';
import { EmailRequestRejectedError } from '../../../integrations/email/email-provider.js';
import type {
  EmailProvider,
  SendEmailCommand,
} from '../../../integrations/email/email-provider.js';

export type DeliveryEvidence = Readonly<{
  outcome: 'ACCEPTED' | 'DELIVERED' | 'UNKNOWN' | 'DEAD_LETTER' | 'RETRYABLE_FAILED';
  providerMessageId?: string;
  errorCode?: string;
}>;
const report = z.object({
  events: z.array(z.object({ messageId: z.string(), event: z.string() })).max(100),
});

/** SMTP acceptance is not delivery. Ambiguous sends keep the original intent. */
export class NotificationEmailDelivery {
  constructor(
    readonly config: BackendConfig['email'],
    readonly provider: EmailProvider = createEmailProvider(config),
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async send(command: SendEmailCommand): Promise<DeliveryEvidence> {
    if (!this.config.enabled) return { outcome: 'DEAD_LETTER', errorCode: 'EMAIL_NOT_CONFIGURED' };
    try {
      const result = await this.provider.send(command);
      const id = z
        .string()
        .min(1)
        .max(320)
        .regex(/^[^\r\n]+$/u)
        .parse(result.messageId);
      return { outcome: 'ACCEPTED', providerMessageId: id };
    } catch (error) {
      if (error instanceof EmailRequestRejectedError) {
        if (error.responseStatus === 429)
          return { outcome: 'RETRYABLE_FAILED', errorCode: 'EMAIL_RATE_LIMITED' };
        if ([401, 402, 403, 404, 405, 406, 413, 422].includes(error.responseStatus))
          return { outcome: 'DEAD_LETTER', errorCode: 'EMAIL_REQUEST_REJECTED' };
      }
      return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_RESULT_UNKNOWN' };
    }
  }
  async reconcile(messageId: string): Promise<DeliveryEvidence> {
    if (!this.config.enabled || this.config.provider !== 'brevo')
      return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_STATUS_UNAVAILABLE' };
    try {
      const url = new URL('https://api.brevo.com/v3/smtp/statistics/events');
      url.searchParams.set('messageId', z.string().min(1).max(320).parse(messageId));
      url.searchParams.set('limit', '100');
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { 'api-key': this.config.apiKey, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_STATUS_UNAVAILABLE' };
      const parsed = report.safeParse(await response.json());
      if (!parsed.success) return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_STATUS_INVALID' };
      const events = parsed.data.events.filter((e) => e.messageId === messageId);
      const delivered = events.some((e) => e.event === 'delivered');
      const rejected = events.some((e) =>
        ['hardBounces', 'hard_bounce', 'blocked', 'invalid', 'error'].includes(e.event),
      );
      if (delivered && !rejected) return { outcome: 'DELIVERED', providerMessageId: messageId };
      if (rejected && !delivered)
        return {
          outcome: 'DEAD_LETTER',
          providerMessageId: messageId,
          errorCode: 'EMAIL_DELIVERY_REJECTED',
        };
      return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_STATUS_PENDING' };
    } catch {
      return { outcome: 'UNKNOWN', errorCode: 'PROVIDER_STATUS_UNAVAILABLE' };
    }
  }
}
