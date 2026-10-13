import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PersonalizedInvitationDeliveryPort } from '../../guest-management/application/guest.contracts.js';
import { type NotificationCrypto } from '../infrastructure/notification-crypto.js';
import {
  credentialAad,
  type NotificationRepository,
} from '../infrastructure/notification.repository.js';
import { parse } from '../domain/notification-policy.js';

export const guestSecretSchema = z.strictObject({ intendedEmail: z.email(), link: z.url() });
export function createPersonalizedDeliveryAdapter(
  repository: NotificationRepository,
  crypto: NotificationCrypto,
  origin: string,
): PersonalizedInvitationDeliveryPort {
  const base = new URL(origin);
  if (
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new TypeError('Invalid Guest delivery origin.');
  return {
    async enqueue(tx, command) {
      const id = randomUUID(),
        now = repository.now();
      const secretExpiresAt = new Date(
        Math.min(command.expiresAt.getTime(), now.getTime() + 72 * 3600000),
      );
      const link = new URL('/guest-invitation', base);
      link.hash = `credential=${command.credential}`;
      const ciphertext = crypto.seal(
        parse(guestSecretSchema, { intendedEmail: command.intendedEmail, link: link.toString() }),
        credentialAad(command.bookingId, id),
      );
      const row = await repository.enqueue(tx, {
        id,
        eventId: command.credentialId,
        bookingId: command.bookingId,
        purpose: 'GUEST_INVITATION',
        recipientId: command.guestId,
        accountId: null,
        channel: 'EMAIL',
        scheduledAt: now,
        credentialId: command.credentialId,
        ciphertext,
        secretExpiresAt,
      });
      return row.id;
    },
  };
}
