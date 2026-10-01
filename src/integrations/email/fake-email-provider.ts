import { createHash } from 'node:crypto';

import { IdempotencyKeyReusedError } from '../../core/errors/app-error.js';
import {
  createSentEmail,
  hashSendEmailPayload,
  validateSendEmailCommand,
  type EmailProvider,
  type SendEmailCommand,
  type SentEmail,
} from './email-provider.js';

interface DeliveryRecord {
  readonly payloadHash: string;
  readonly result: SentEmail;
}

export class FakeEmailProvider implements EmailProvider {
  readonly #deliveries = new Map<string, DeliveryRecord>();

  get deliveryCount(): number {
    return this.#deliveries.size;
  }

  send(command: SendEmailCommand): Promise<SentEmail> {
    return Promise.resolve().then(() => {
      const validated = validateSendEmailCommand(command);
      const payloadHash = hashSendEmailPayload(validated);
      const existing = this.#deliveries.get(validated.idempotencyKey);

      if (existing !== undefined) {
        if (existing.payloadHash !== payloadHash) {
          throw new IdempotencyKeyReusedError();
        }
        return existing.result;
      }

      const result = createSentEmail(
        validated.idempotencyKey,
        deterministicMessageId(validated.idempotencyKey),
      );
      this.#deliveries.set(validated.idempotencyKey, { payloadHash, result });
      return result;
    });
  }
}

function deterministicMessageId(idempotencyKey: string): string {
  const hash = createHash('sha256').update(idempotencyKey).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
