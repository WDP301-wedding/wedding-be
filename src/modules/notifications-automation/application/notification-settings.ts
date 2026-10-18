import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  AppError,
  NotFoundError,
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  lockNotificationActor,
  requireNotificationRole,
} from '../../identity-access/authorization/notification-authority.js';
import { createNotificationIdentityReader } from '../../identity-access/authorization/notification-recipient.reader.js';
import type { createNotificationBookingReader } from '../../booking-lifecycle/infrastructure/notification-context.reader.js';
import { digest, notificationConflict, parse } from '../domain/notification-policy.js';
import { notificationTemplate } from '../domain/notification-template.js';
import type { NotificationFoundation } from '../infrastructure/notification-foundation.js';
import { createNotificationInboxReader } from '../infrastructure/notification-inbox.reader.js';
import {
  preferencesBody,
  installationBody,
  revisionBody,
  registryBody,
  requeueBody,
  readAllBody,
  listQuery,
  managementQuery,
  id,
  statusDto,
  inboxDto,
  registryDto,
  installationDto,
} from '../http/notification.schemas.js';

export class NotificationSettings {
  readonly inboxReader: ReturnType<typeof createNotificationInboxReader>;
  constructor(
    readonly foundation: NotificationFoundation,
    readonly resolver: AuthenticatedActorResolver,
    readonly booking: ReturnType<typeof createNotificationBookingReader>,
    readonly requestId: string = randomUUID(),
  ) {
    this.inboxReader = createNotificationInboxReader(
      foundation.prisma,
      booking.notificationBookingIdsQuery,
    );
  }
  withRequestId(value: string) {
    return new NotificationSettings(this.foundation, this.resolver, this.booking, parse(id, value));
  }
  private async actor(token: string, manager = false) {
    const actor = await this.resolver.resolve(token);
    // These role branches are pure checks. Only roleless consultation accounts
    // need a database-backed role gate; commands still lock and revalidate.
    if (!(actor.roles.includes('MANAGER') || (!manager && actor.roles.includes('COUPLE'))))
      await this.foundation.prisma.$transaction((tx) =>
        requireNotificationRole(tx, actor, manager),
      );
    return actor;
  }
  private async command<T>(
    token: string,
    key: string | undefined,
    action: string,
    value: unknown,
    manager: boolean,
    work: (
      tx: Prisma.TransactionClient,
      actor: Awaited<ReturnType<typeof lockNotificationActor>>,
    ) => Promise<T>,
  ) {
    if (key === undefined) throw new IdempotencyKeyRequiredError();
    const validated = idempotencyKeySchema.safeParse(key);
    if (!validated.success) throw new InvalidIdempotencyKeyError();
    const actor = await this.actor(token, manager);
    const intentDigest = digest({ action, key: validated.data });
    const commandDigest = digest(value);
    return this.foundation.prisma.$transaction(async (tx) => {
      const current = await lockNotificationActor(tx, token, actor, this.foundation.now());
      await requireNotificationRole(tx, current, manager);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-command:${actor.accountId}:${intentDigest}`},0))`;
      const prior = await tx.notificationCommand.findUnique({
        where: { accountId_intentDigest: { accountId: actor.accountId, intentDigest } },
      });
      if (prior) {
        if (prior.commandDigest !== commandDigest)
          throw notificationConflict('IDEMPOTENCY_KEY_REUSED');
        return prior.result as T;
      }
      const result = await work(tx, current);
      await tx.notificationCommand.create({
        data: {
          accountId: actor.accountId,
          intentDigest,
          commandDigest,
          result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
          createdAt: this.foundation.now(),
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: this.requestId,
          actorType: 'USER',
          actorId: actor.accountId,
          action: `notifications.${action}`,
          entityType: 'notification-account',
          entityId: actor.accountId,
          metadata: { intentDigest, commandDigest },
        },
      });
      return result;
    });
  }
  async preferences(token: string) {
    const actor = await this.actor(token);
    const row = await this.foundation.prisma.notificationPreference.findUnique({
      where: { accountId: actor.accountId },
    });
    return row
      ? { revision: row.revision, reminderEmail: row.reminderEmail, reminderPush: row.reminderPush }
      : { revision: 0, reminderEmail: true, reminderPush: true };
  }
  patchPreferences(token: string, value: unknown, key: string | undefined) {
    const input = parse(preferencesBody, value);
    return this.command(token, key, 'preferences', input, false, async (tx, actor) => {
      await lockAccount(tx, actor.accountId);
      const prior = await tx.notificationPreference.findUnique({
        where: { accountId: actor.accountId },
      });
      if ((prior?.revision ?? 0) !== input.expectedRevision) throw stale();
      const data = {
        reminderEmail: input.reminderEmail ?? prior?.reminderEmail ?? true,
        reminderPush: input.reminderPush ?? prior?.reminderPush ?? true,
        revision: (prior?.revision ?? 0) + 1,
      };
      await tx.notificationPreference.upsert({
        where: { accountId: actor.accountId },
        create: { accountId: actor.accountId, ...data },
        update: data,
      });
      return data;
    });
  }
  async installations(token: string) {
    const actor = await this.actor(token);
    const rows = await this.foundation.prisma.notificationInstallation.findMany({
      where: { accountId: actor.accountId },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) =>
      installationDto.parse({
        id: row.id,
        installationId: row.installationId,
        revision: row.revision,
        enabled: row.enabled,
      }),
    );
  }
  register(token: string, value: unknown, key: string | undefined) {
    const input = parse(installationBody, value);
    return this.command(token, key, 'installation.register', input, false, async (tx, actor) => {
      if (actor.clientKind !== 'ANDROID') throw forbidden();
      await lockAccount(tx, actor.accountId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-token:${digest(input.pushToken)}`},0))`;
      const prior = await tx.notificationInstallation.findUnique({
        where: {
          accountId_installationId: {
            accountId: actor.accountId,
            installationId: input.installationId,
          },
        },
      });
      if ((prior?.revision ?? 0) !== input.expectedRevision) throw stale();
      const other = await tx.notificationInstallation.findUnique({
        where: { pushToken: input.pushToken },
      });
      if (other && other.id !== prior?.id) {
        if (
          other.enabled &&
          (await createNotificationIdentityReader(
            this.foundation.prisma,
            this.foundation.now,
          ).androidSession(other.accountId, other.sessionId))
        )
          throw notificationConflict('ANDROID_TOKEN_IN_USE');
        await tx.notificationInstallation.update({
          where: { id: other.id },
          data: { enabled: false, pushToken: null, revision: { increment: 1 } },
        });
      }
      const active = await tx.notificationInstallation.count({
        where: { accountId: actor.accountId, enabled: true },
      });
      if (!prior?.enabled && active >= 5) throw notificationConflict('ANDROID_INSTALLATION_LIMIT');
      const data = {
        sessionId: actor.sessionId,
        pushToken: input.pushToken,
        enabled: true,
        revision: (prior?.revision ?? 0) + 1,
      };
      const row = await tx.notificationInstallation.upsert({
        where: {
          accountId_installationId: {
            accountId: actor.accountId,
            installationId: input.installationId,
          },
        },
        create: { accountId: actor.accountId, installationId: input.installationId, ...data },
        update: data,
      });
      return installationDto.parse({
        id: row.id,
        installationId: row.installationId,
        revision: row.revision,
        enabled: row.enabled,
      });
    });
  }
  revoke(token: string, idValue: string, value: unknown, key: string | undefined) {
    const installationId = parse(id, idValue),
      input = parse(revisionBody, value);
    return this.command(
      token,
      key,
      `installation.revoke:${installationId}`,
      input,
      false,
      async (tx, actor) => {
        await lockAccount(tx, actor.accountId);
        const prior = await tx.notificationInstallation.findFirst({
          where: { id: installationId, accountId: actor.accountId },
        });
        if (!prior) throw new NotFoundError();
        if (prior.revision !== input.expectedRevision) throw stale();
        const row = await tx.notificationInstallation.update({
          where: { id: prior.id },
          data: { enabled: false, pushToken: null, revision: { increment: 1 } },
        });
        return installationDto.parse({
          id: row.id,
          installationId: row.installationId,
          revision: row.revision,
          enabled: row.enabled,
        });
      },
    );
  }
  async registry(token: string) {
    const actor = await this.actor(token, true);
    const row = await this.foundation.prisma.notificationRecipient.findFirst({
      where: { accountId: actor.accountId, operational: true },
    });
    return row
      ? registryDto.parse({
          id: row.id,
          revision: row.revision,
          enabled: row.enabled,
          operational: row.operational,
          purposes: row.purposes,
        })
      : null;
  }
  patchRegistry(token: string, value: unknown, key: string | undefined) {
    const input = parse(registryBody, value);
    return this.command(token, key, 'recipient', input, true, async (tx, actor) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-recipient:${actor.accountId}`},0))`;
      const prior = await tx.notificationRecipient.findFirst({
        where: { accountId: actor.accountId },
      });
      if ((prior?.revision ?? 0) !== input.expectedRevision) throw stale();
      if (
        input.purposes.some((p) =>
          ['WORKSPACE_INVITATION', 'PASSWORD_OTP', 'GUEST_INVITATION'].includes(p),
        )
      )
        throw new AppError({
          status: 422,
          code: 'VALIDATION_ERROR',
          message: 'Privileged credential recipients use their owner delivery ports.',
        });
      const data = {
        enabled: input.enabled,
        purposes: [...new Set(input.purposes)].sort(),
        operational: true,
        deliveryEmail: input.enabled ? (input.intendedEmail ?? prior?.deliveryEmail ?? null) : null,
        revision: (prior?.revision ?? 0) + 1,
      };
      const row = prior
        ? await tx.notificationRecipient.update({ where: { id: prior.id }, data })
        : await tx.notificationRecipient.create({ data: { accountId: actor.accountId, ...data } });
      return registryDto.parse({
        id: row.id,
        operational: row.operational,
        enabled: row.enabled,
        purposes: row.purposes,
        revision: row.revision,
      });
    });
  }
  async statuses(token: string, value: unknown) {
    await this.actor(token, true);
    const input = parse(managementQuery, value);
    const where = {
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.state ? { state: input.state } : {}),
    };
    if (
      input.cursor &&
      !(await this.foundation.prisma.notificationIntent.findFirst({
        where: { id: input.cursor, ...where },
        select: { id: true },
      }))
    )
      throw new NotFoundError();
    const rows = await this.foundation.prisma.notificationIntent.findMany({
      where,
      take: input.limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: {
        attempts: {
          where: { errorCode: { not: null } },
          take: 1,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          select: { errorCode: true },
        },
      },
    });
    return {
      items: rows.slice(0, input.limit).map((r) => status(r, r.attempts[0]?.errorCode ?? null)),
      nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
    };
  }
  requeue(token: string, idValue: string, value: unknown, key: string | undefined) {
    const intentId = parse(id, idValue),
      input = parse(requeueBody, value);
    return this.command(token, key, `requeue:${intentId}`, input, true, async (tx, actor) => {
      await tx.$queryRaw`SELECT id FROM "NotificationIntent" WHERE id=${intentId}::uuid FOR UPDATE`;
      const row = await tx.notificationIntent.findUnique({ where: { id: intentId } });
      if (!row) throw new NotFoundError();
      if (row.revision !== input.expectedRevision) throw stale();
      if (row.state !== 'DEAD_LETTER')
        throw notificationConflict('NOTIFICATION_REQUEUE_NOT_ELIGIBLE');
      if (await tx.notificationCredential.findUnique({ where: { intentId } }))
        throw notificationConflict('NOTIFICATION_CREDENTIAL_REISSUE_REQUIRED');
      await tx.notificationPushDelivery.updateMany({
        where: { intentId, state: 'DEAD_LETTER', errorCode: { not: 'FCM_UNREGISTERED' } },
        data: { state: 'QUEUED', errorCode: null, updatedAt: this.foundation.now() },
      });
      const updated = await tx.notificationIntent.update({
        where: { id: intentId },
        data: {
          state: 'QUEUED',
          attemptCount: 0,
          nextAttemptAt: this.foundation.now(),
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: this.requestId,
          actorType: 'USER',
          actorId: actor.accountId,
          action: 'notification.requeue-reason',
          entityType: 'notification-intent',
          entityId: intentId,
          metadata: { reason: input.reason, revision: updated.revision },
        },
      });
      return status(updated, null);
    });
  }
  private async inboxScope(token: string) {
    const actor = await this.actor(token);
    const bookingIds = await this.booking.notificationBookingIds(
      actor.accountId,
      actor.roles.includes('MANAGER'),
    );
    return this.capturedInboxScope(actor, bookingIds);
  }
  private capturedInboxScope(
    actor: Awaited<ReturnType<NotificationSettings['actor']>>,
    bookingIds: string[],
  ) {
    return {
      actor,
      where: {
        accountId: actor.accountId,
        OR: [{ bookingId: null }, { bookingId: { in: bookingIds.sort() } }],
      },
    };
  }
  private async recheckInboxScope(
    token: string,
    scope: Awaited<ReturnType<NotificationSettings['inboxScope']>>,
  ) {
    const wasManager = scope.actor.roles.includes('MANAGER');
    // Both checks follow the data read. Audience lookup depends only on the
    // captured principal; a changed principal/Manager role is rejected below.
    const [actor, bookingIds] = await Promise.all([
      this.actor(token),
      this.booking.notificationBookingIds(scope.actor.accountId, wasManager),
    ]);
    const currentWhere = {
      accountId: actor.accountId,
      OR: [{ bookingId: null }, { bookingId: { in: bookingIds.sort() } }],
    };
    if (
      actor.roles.includes('MANAGER') !== wasManager ||
      JSON.stringify(currentWhere) !== JSON.stringify(scope.where)
    )
      throw new NotFoundError();
  }
  async inbox(token: string, value: unknown) {
    const actor = await this.actor(token),
      input = parse(listQuery, value);
    const snapshot = await this.inboxReader.page(
      actor.accountId,
      actor.roles.includes('MANAGER'),
      input,
    );
    if (!snapshot.cursorVisible) throw new NotFoundError();
    const scope = this.capturedInboxScope(actor, snapshot.bookingIds),
      rows = snapshot.rows;
    await this.recheckInboxScope(token, scope);
    return {
      items: rows.slice(0, input.limit).map((row) => {
        const purpose = parse(statusDto.shape.purpose, row.purpose),
          template = notificationTemplate(purpose, row.intentData);
        return inboxDto.parse({
          id: row.id,
          notificationIntentId: row.intentId,
          purpose,
          title: template.subject,
          message: template.text,
          createdAt: new Date(row.createdAt).toISOString(),
          readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
          revision: row.revision,
          resource: { bookingId: row.bookingId, owner: row.intentOwner, data: template.data },
        });
      }),
      nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.id : null,
    };
  }
  async unread(token: string) {
    const actor = await this.actor(token);
    const snapshot = await this.inboxReader.unread(
      actor.accountId,
      actor.roles.includes('MANAGER'),
    );
    const scope = this.capturedInboxScope(actor, snapshot.bookingIds);
    await this.recheckInboxScope(token, scope);
    return { count: snapshot.count };
  }
  async markRead(token: string, idValue: string, value: unknown, key: string | undefined) {
    const inboxId = parse(id, idValue),
      input = parse(revisionBody, value),
      { where } = await this.inboxScope(token);
    return this.command(token, key, `inbox.read:${inboxId}`, input, false, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NotificationInbox" WHERE id=${inboxId}::uuid FOR UPDATE`;
      const row = await tx.notificationInbox.findFirst({ where: { id: inboxId, ...where } });
      if (!row) throw new NotFoundError();
      if (row.revision !== input.expectedRevision) throw stale();
      const updated = row.readAt
        ? row
        : await tx.notificationInbox.update({
            where: { id: row.id },
            data: { readAt: this.foundation.now(), revision: { increment: 1 } },
          });
      return { id: updated.id, revision: updated.revision, readAt: updated.readAt!.toISOString() };
    });
  }
  async readAll(token: string, value: unknown, key: string | undefined) {
    const input = parse(readAllBody, value),
      { where } = await this.inboxScope(token);
    if (new Date(input.throughCreatedAt) > this.foundation.now())
      throw new AppError({
        status: 422,
        code: 'VALIDATION_ERROR',
        message: 'The read fence cannot be in the future.',
      });
    return this.command(token, key, 'inbox.read-all', input, false, async (tx) => {
      const updated = await tx.notificationInbox.updateMany({
        where: { ...where, readAt: null, createdAt: { lte: new Date(input.throughCreatedAt) } },
        data: { readAt: this.foundation.now(), revision: { increment: 1 } },
      });
      return { count: updated.count, throughCreatedAt: input.throughCreatedAt };
    });
  }
}
function status(
  row: {
    id: string;
    eventId: string;
    bookingId: string | null;
    channel: string;
    purpose: string;
    state: string;
    revision: number;
    attemptCount: number;
    scheduledAt: Date;
    createdAt: Date;
  },
  lastErrorCode: string | null,
) {
  return statusDto.parse({
    id: row.id,
    eventId: row.eventId,
    bookingId: row.bookingId,
    channel: row.channel,
    purpose: row.purpose,
    state: row.state,
    revision: row.revision,
    attemptCount: row.attemptCount,
    scheduledAt: row.scheduledAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lastErrorCode,
  });
}
async function lockAccount(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-settings:${id}`},0))`;
}
const stale = () => notificationConflict('NOTIFICATION_REVISION_STALE');
const forbidden = () =>
  new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'An active Android session is required.',
  });
