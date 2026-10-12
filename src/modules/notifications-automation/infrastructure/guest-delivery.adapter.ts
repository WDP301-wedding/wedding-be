import type { GuestCredentialDelivery } from '../../guest-management/application/guest.contracts.js';
import type { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import type { CredentialCipher } from './credential-cipher.js';
import type { NotificationFoundation } from './notification-foundation.js';

export function createGuestDeliveryAdapter(
  guests: ReturnType<typeof createGuestServices>,
  foundation: NotificationFoundation,
  cipher: CredentialCipher,
): GuestCredentialDelivery {
  return {
    async retain(command, scope) {
      const tx = guests.boundary.requireScope(command.bookingId, scope);
      const recipient =
        (await tx.notificationRecipient.findFirst({
          where: {
            bookingId: command.bookingId,
            guestId: command.guestId,
            deliveryEmail: command.intendedEmail,
            purposes: { has: 'GUEST_INVITATION' },
            enabled: true,
          },
        })) ??
        (await tx.notificationRecipient.create({
          data: {
            bookingId: command.bookingId,
            guestId: command.guestId,
            deliveryEmail: command.intendedEmail,
            purposes: ['GUEST_INVITATION'],
          },
        }));
      const intent = await foundation.enqueueScoped(
        {
          eventId: command.credentialId,
          owner: 'guest-management',
          bookingId: command.bookingId,
          recipientId: recipient.id,
          channel: 'EMAIL',
          purpose: 'GUEST_INVITATION',
          templateVersion: 1,
          scheduledAt: guests.guests.now().toISOString(),
          data: { referenceId: command.credentialId },
        },
        scope,
      );
      const sealed = cipher.seal(command.credential, command.expiresAt, {
        intentId: intent.id,
        bookingId: command.bookingId,
        purpose: 'GUEST_INVITATION',
      });
      await tx.notificationCredential.create({
        data: {
          ...sealed,
          intentId: intent.id,
          credentialId: command.credentialId,
          createdAt: guests.guests.now(),
        },
      });
      return { notificationIntentId: intent.id };
    },
  };
}
