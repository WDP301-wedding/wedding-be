import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  NotificationClient,
  NotificationRepository,
} from '../infrastructure/notification.repository.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { NotificationCrypto } from '../infrastructure/notification-crypto.js';
import type { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import type { GuestRequestContext } from '../../guest-management/application/guest.contracts.js';
import { createNotificationRecipientReader } from '../../identity-access/authorization/notification-recipient.reader.js';
import { createNotificationScopeReader } from '../../booking-lifecycle/infrastructure/notification-scope.reader.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { handlers, type Purpose } from './notification-events.js';
import {
  conflict,
  forbidden,
  parse,
  preferencesInput,
  installationInput,
  revisionInput,
  requeueInput,
  resolutionInput,
  registryInput,
  pageInput,
  operationsInput,
  deliveryInput,
} from '../domain/notification-policy.js';
import { createPersonalizedDeliveryAdapter } from './guest-delivery.adapter.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const preferenceDto = (
  row: { revision: number; reminderEmail: boolean; reminderPush: boolean } | null,
) => row ?? { revision: 0, reminderEmail: true, reminderPush: true };
export class NotificationService {
  constructor(
    readonly repository: NotificationRepository,
    readonly crypto: NotificationCrypto,
    readonly guests: ReturnType<typeof createGuestServices>,
    readonly origin: string | null,
  ) {}
  readonly resolver = { resolve: (token: string) => this.guests.identity.resolver.resolve(token) };
  async actor(context: GuestRequestContext, manager = false) {
    const actor = await this.resolver.resolve(context.accessToken);
    if (
      actor.accountId !== context.actorId ||
      (manager
        ? !actor.roles.includes('MANAGER')
        : !actor.roles.some((r) => r === 'MANAGER' || r === 'COUPLE'))
    )
      throw forbidden();
    return actor;
  }
  private async command<T>(
    action: string,
    value: unknown,
    keyValue: string,
    context: GuestRequestContext,
    manager: boolean,
    work: (tx: NotificationClient, actor: AuthenticatedActor) => Promise<T>,
  ): Promise<T> {
    const key = parse(z.uuid(), keyValue),
      actor = await this.actor(context, manager),
      digest = hash({ action, value });
    return this.repository.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.accountId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "AccountRole" WHERE "accountId"=${actor.accountId}::uuid ORDER BY id FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${actor.sessionId}::uuid FOR SHARE`;
      const current = await this.actor(context, manager);
      const prior = await tx.notificationCommand.findUnique({
        where: { accountId_key: { accountId: actor.accountId, key } },
      });
      if (prior !== null) {
        if (prior.commandDigest !== digest) throw conflict('IDEMPOTENCY_KEY_REUSED');
        return prior.result as T;
      }
      const result = await work(tx, current);
      await tx.notificationCommand.create({
        data: {
          accountId: actor.accountId,
          key,
          commandDigest: digest,
          result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: context.requestId,
          actorType: 'USER',
          actorId: actor.accountId,
          action: `notifications.${action.split(':')[0]}`,
          entityType: 'notification-command',
          metadata: { commandKey: key },
        },
      });
      return result;
    });
  }
  async preferences(context: GuestRequestContext) {
    const actor = await this.actor(context);
    return preferenceDto(
      await this.repository.prisma.notificationPreference.findUnique({
        where: { accountId: actor.accountId },
        select: { revision: true, reminderEmail: true, reminderPush: true },
      }),
    );
  }
  setPreferences(value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(preferencesInput, value);
    return this.command('preferences', input, key, context, false, async (tx, actor) => {
      const current = await tx.notificationPreference.findUnique({
        where: { accountId: actor.accountId },
      });
      if ((current?.revision ?? 0) !== input.expectedRevision) throw conflict();
      const row = await tx.notificationPreference.upsert({
        where: { accountId: actor.accountId },
        create: {
          accountId: actor.accountId,
          reminderEmail: input.reminderEmail,
          reminderPush: input.reminderPush,
        },
        update: {
          reminderEmail: input.reminderEmail,
          reminderPush: input.reminderPush,
          revision: { increment: 1 },
        },
      });
      return {
        revision: row.revision,
        reminderEmail: row.reminderEmail,
        reminderPush: row.reminderPush,
      };
    });
  }
  register(value: unknown, key: string, context: GuestRequestContext) {
    const input = parse(installationInput, value);
    return this.command(
      'android-register',
      { installationId: input.installationId, tokenDigest: hash(input.pushToken) },
      key,
      context,
      false,
      async (tx, actor) => {
        if (
          !(await createNotificationRecipientReader(tx, this.repository.now).android(
            actor.accountId,
            actor.sessionId,
          ))
        )
          throw forbidden();
        const previous = await tx.notificationInstallation.findUnique({
            where: { id: input.installationId },
          }),
          other = await tx.notificationInstallation.findUnique({
            where: { tokenDigest: hash(input.pushToken) },
          });
        if (
          (previous !== null && previous.accountId !== actor.accountId) ||
          (other !== null && other.id !== input.installationId)
        )
          throw conflict('INSTALLATION_CONFLICT');
        if (
          previous?.active !== true &&
          (await tx.notificationInstallation.count({
            where: { accountId: actor.accountId, active: true },
          })) >= 5
        )
          throw conflict('INSTALLATION_LIMIT');
        const ciphertext = this.crypto.seal(
          input.pushToken,
          `${actor.accountId}/ANDROID/${input.installationId}`,
        );
        const row = await tx.notificationInstallation.upsert({
          where: { id: input.installationId },
          create: {
            id: input.installationId,
            accountId: actor.accountId,
            sessionId: actor.sessionId,
            tokenDigest: hash(input.pushToken),
            ciphertext,
          },
          update: {
            sessionId: actor.sessionId,
            tokenDigest: hash(input.pushToken),
            ciphertext,
            active: true,
            revision: { increment: 1 },
          },
        });
        return { installationId: row.id, revision: row.revision, active: row.active };
      },
    );
  }
  revoke(idValue: string, value: unknown, key: string, context: GuestRequestContext) {
    const id = parse(z.uuid(), idValue),
      input = parse(revisionInput, value);
    return this.command(`android-revoke:${id}`, input, key, context, false, async (tx, actor) => {
      const row = await tx.notificationInstallation.findFirst({
        where: { id, accountId: actor.accountId },
      });
      if (row === null) throw new NotFoundError();
      if (row.revision !== input.expectedRevision) throw conflict();
      const saved = await tx.notificationInstallation.update({
        where: { id },
        data: { active: false, ciphertext: null, revision: { increment: 1 } },
      });
      return { installationId: saved.id, revision: saved.revision, active: saved.active };
    });
  }
  registry(bookingValue: string, value: unknown, key: string, context: GuestRequestContext) {
    const bookingId = parse(z.uuid(), bookingValue),
      input = parse(registryInput, value);
    return this.command(`recipient:${bookingId}`, input, key, context, true, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${bookingId}`}))`;
      if ((await tx.booking.count({ where: { id: bookingId } })) !== 1) throw new NotFoundError();
      if (
        !(await createNotificationRecipientReader(tx, this.repository.now).manager(input.accountId))
      )
        throw forbidden();
      const where = { bookingId, accountId: input.accountId, purpose: input.purpose },
        row = await tx.notificationRecipient.findUnique({
          where: { bookingId_accountId_purpose: where },
        });
      if ((row?.revision ?? 0) !== input.expectedRevision) throw conflict();
      const saved = await tx.notificationRecipient.upsert({
        where: { bookingId_accountId_purpose: where },
        create: { ...where, enabled: input.enabled },
        update: { enabled: input.enabled, revision: { increment: 1 } },
      });
      return {
        bookingId,
        accountId: saved.accountId,
        purpose: saved.purpose,
        enabled: saved.enabled,
        revision: saved.revision,
      };
    });
  }
  async deliver(
    bookingId: string,
    guestId: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
  ) {
    await this.actor(context);
    const input = parse(deliveryInput, value);
    if (this.origin === null) throw conflict('GUEST_DELIVERY_UNCONFIGURED');
    return this.guests.links.deliver(
      bookingId,
      guestId,
      input,
      key,
      context,
      createPersonalizedDeliveryAdapter(this.repository, this.crypto, this.origin),
    );
  }
  private async visible(tx: NotificationClient, bookingId: string, actor: AuthenticatedActor) {
    return (
      actor.roles.includes('MANAGER') ||
      (await createNotificationScopeReader(tx).canRead(bookingId, actor.accountId))
    );
  }
  async inbox(value: unknown, context: GuestRequestContext) {
    const input = parse(pageInput, value),
      actor = await this.actor(context),
      prisma = this.repository.prisma;
    // Filter by current booking access before applying pagination; unrelated scopes
    // never cause missing/empty pages or leak identifiers after access revocation.
    const accesses = await prisma.consultationAccess.findMany({
      where: { accountId: actor.accountId },
      select: { consultationId: true },
    });
    const bookings = actor.roles.includes('MANAGER')
      ? null
      : await prisma.booking.findMany({
          where: { consultationId: { in: accesses.map((a) => a.consultationId) } },
          select: { id: true },
        });
    const where = {
      accountId: actor.accountId,
      channel: 'EMAIL',
      purpose: { in: Object.keys(handlers) },
      createdAt: { gte: new Date(this.repository.now().getTime() - 90 * 86400000) },
      ...(bookings === null ? {} : { bookingId: { in: bookings.map((b) => b.id) } }),
    };
    const rows = await prisma.notificationIntent.findMany({
      where: { ...where, ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }) },
      orderBy: { id: 'asc' },
      take: input.limit + 1,
    });
    const items = rows.slice(0, input.limit).map((row) => ({
      notificationIntentId: row.id,
      bookingId: row.bookingId,
      purpose: row.purpose,
      title: handlers[row.purpose as Purpose].title,
      target: {
        screen: handlers[row.purpose as Purpose].screen,
        bookingId: row.bookingId,
        referenceId: row.referenceId,
      },
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      revision: row.revision,
    }));
    return {
      items,
      nextCursor: rows.length > input.limit ? items.at(-1)!.notificationIntentId : null,
      unreadCount: await prisma.notificationIntent.count({ where: { ...where, readAt: null } }),
    };
  }
  markRead(idValue: string, value: unknown, key: string, context: GuestRequestContext) {
    const id = parse(z.uuid(), idValue),
      input = parse(revisionInput, value);
    return this.command(`read:${id}`, input, key, context, false, async (tx, actor) => {
      await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.notificationIntent.findFirst({
        where: {
          id,
          accountId: actor.accountId,
          channel: 'EMAIL',
          createdAt: { gte: new Date(this.repository.now().getTime() - 90 * 86400000) },
        },
      });
      if (row === null || !(await this.visible(tx, row.bookingId, actor)))
        throw new NotFoundError();
      if (row.revision !== input.expectedRevision) throw conflict();
      const saved =
        row.readAt !== null
          ? row
          : await tx.notificationIntent.update({
              where: { id },
              data: { readAt: this.repository.now(), revision: { increment: 1 } },
            });
      return {
        notificationIntentId: id,
        readAt: saved.readAt!.toISOString(),
        revision: saved.revision,
      };
    });
  }
  async operations(value: unknown, context: GuestRequestContext) {
    await this.actor(context, true);
    const input = parse(operationsInput, value);
    const rows = await this.repository.prisma.notificationIntent.findMany({
      where: {
        ...(input.cursor === undefined ? {} : { id: { gt: input.cursor } }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      },
      orderBy: { id: 'asc' },
      take: input.limit + 1,
    });
    const items = rows.slice(0, input.limit).map((row) => ({
      notificationIntentId: row.id,
      eventId: row.eventId,
      bookingId: row.bookingId,
      purpose: row.purpose,
      channel: row.channel,
      state: row.state,
      revision: row.revision,
      attemptCount: row.attemptCount,
      scheduledAt: row.scheduledAt.toISOString(),
      hasProviderReceipt: row.providerMessageId !== null,
    }));
    return {
      items,
      nextCursor: rows.length > input.limit ? items.at(-1)!.notificationIntentId : null,
    };
  }
  recover(
    idValue: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
    resolve = false,
  ) {
    const id = parse(z.uuid(), idValue),
      input = resolve ? parse(resolutionInput, value) : parse(requeueInput, value);
    return this.command(
      `${resolve ? 'resolve' : 'requeue'}:${id}`,
      input,
      key,
      context,
      true,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${id}::uuid FOR UPDATE`;
        const row = await tx.notificationIntent.findUnique({ where: { id } });
        if (row === null) throw new NotFoundError();
        if (row.revision !== input.expectedRevision) throw conflict();
        let state: string;
        if ('outcome' in input) {
          const resolved = parse(resolutionInput, input);
          if (row.state !== 'UNKNOWN') throw conflict('NOTIFICATION_OUTCOME_NOT_UNKNOWN');
          state =
            resolved.outcome === 'DELIVERED'
              ? 'DELIVERED'
              : row.attemptCount >= 6
                ? 'DEAD_LETTER'
                : 'RETRYABLE_FAILED';
          await tx.notificationAttempt.create({
            data: {
              intentId: id,
              attemptNumber: row.attemptCount,
              outcome: input.outcome === 'DELIVERED' ? 'RESOLVED_DELIVERED' : 'RESOLVED_NOT_SENT',
              errorCode: 'OPERATOR_EVIDENCE',
            },
          });
          await tx.auditLog.create({
            data: {
              requestId: context.requestId,
              actorType: 'USER',
              actorId: context.actorId,
              action: 'notifications.outcome-resolved',
              entityType: 'notification-intent',
              entityId: id,
              metadata: {
                reason: input.reason,
                evidenceReference: resolved.evidenceReference,
                outcome: resolved.outcome,
              },
            },
          });
        } else {
          if (
            !['DEAD_LETTER', 'RETRYABLE_FAILED'].includes(row.state) ||
            row.attemptCount >= 6 ||
            (row.purpose === 'GUEST_INVITATION' &&
              (row.ciphertext === null || row.secretExpiresAt! <= this.repository.now()))
          )
            throw conflict('NOTIFICATION_REQUEUE_INELIGIBLE');
          state = 'QUEUED';
          await tx.auditLog.create({
            data: {
              requestId: context.requestId,
              actorType: 'USER',
              actorId: context.actorId,
              action: 'notifications.requeued',
              entityType: 'notification-intent',
              entityId: id,
              metadata: { reason: input.reason },
            },
          });
        }
        const saved = await tx.notificationIntent.update({
          where: { id },
          data: {
            state,
            revision: { increment: 1 },
            nextAttemptAt: this.repository.now(),
            ...(state === 'DELIVERED' ? { ciphertext: null } : {}),
          },
        });
        return { notificationIntentId: id, state: saved.state, revision: saved.revision };
      },
    );
  }
}
