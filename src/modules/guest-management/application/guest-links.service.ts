import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, GuestInvitationCredential } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { GuestService } from './guest.service.js';
import type { GuestRequestContext, PersonalizedInvitationDeliveryPort } from './guest.contracts.js';
import {
  conflict,
  digest,
  id,
  linkIssueSchema,
  parse,
  tokenHash,
  unavailable,
} from '../domain/guest-policy.js';

export class GuestLinksService {
  constructor(readonly guests: GuestService) {}
  async issue(
    bookingValue: string,
    guestValue: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
  ) {
    const result = await this.issueInternal(bookingValue, guestValue, value, key, context);
    if (result.credential === undefined) throw conflict('INVITATION_CREDENTIAL_ALREADY_ISSUED');
    return {
      credentialId: result.credentialId,
      revision: result.revision,
      expiresAt: result.expiresAt,
      credential: result.credential,
      fragment: `#credential=${result.credential}`,
    };
  }
  async deliver(
    bookingId: string,
    guestId: string,
    value: { expectedRevision: number; intendedEmail: string },
    key: string,
    context: GuestRequestContext,
    port: PersonalizedInvitationDeliveryPort,
  ) {
    const result = await this.issueInternal(
      bookingId,
      guestId,
      { expectedRevision: value.expectedRevision },
      key,
      context,
      { intendedEmail: value.intendedEmail, port },
    );
    return {
      credentialId: result.credentialId,
      revision: result.revision,
      expiresAt: result.expiresAt,
      notificationIntentId: result.notificationIntentId!,
    };
  }
  private async issueInternal(
    bookingValue: string,
    guestValue: string,
    value: unknown,
    key: string,
    context: GuestRequestContext,
    delivery?: { intendedEmail: string; port: PersonalizedInvitationDeliveryPort },
  ) {
    const bookingId = parse(id, bookingValue),
      guestId = parse(id, guestValue),
      input = parse(linkIssueSchema, value);
    let credential: string | undefined;
    const result = await this.guests.command(
      bookingId,
      context,
      key,
      `${delivery === undefined ? 'invitation.issue' : 'invitation.deliver'}:${guestId}`,
      delivery === undefined ? input : { ...input, intendedEmail: delivery.intendedEmail },
      async (tx, scope) => {
        const guest = await this.guests.requireGuest(tx, bookingId, guestId);
        if (guest.status !== 'ACTIVE') throw unavailable();
        const latest = await tx.guestInvitationCredential.findFirst({
          where: { bookingId, guestId },
          orderBy: { revision: 'desc' },
        });
        if ((latest?.revision ?? 0) !== input.expectedRevision)
          throw conflict('GUEST_INVITATION_REVISION_STALE');
        const invitation = await this.publication(bookingId);
        const event = await this.guests.owners.booking.requireConfirmedEventContext(bookingId);
        const timeline = await this.guests.owners.timeline.resolveApprovedRevision(
          { bookingId, timelineRevisionId: event.effectiveTimelineRevisionId },
          scope,
        );
        const expiresAt = new Date(
          new Date(`${timeline.eventDate}T${timeline.shiftEndTime}:00+07:00`).getTime() +
            24 * 3600000,
        );
        if (expiresAt <= this.guests.now()) throw unavailable();
        await tx.guestInvitationCredential.updateMany({
          where: { bookingId, guestId, revokedAt: null },
          data: { revokedAt: this.guests.now() },
        });
        credential = `wgc_${randomBytes(32).toString('base64url')}`;
        const credentialId = randomUUID();
        await tx.guestInvitationCredential.create({
          data: {
            id: credentialId,
            bookingId,
            guestId,
            tokenHash: tokenHash(credential),
            publicInvitationId: invitation.publicInvitationId,
            revision: input.expectedRevision + 1,
            expiresAt,
          },
        });
        await this.guests.repository.audit(
          tx,
          scope,
          bookingId,
          'guest.invitation-issued',
          credentialId,
          input.expectedRevision + 1,
        );
        const notificationIntentId =
          delivery === undefined
            ? undefined
            : await delivery.port.enqueue(tx, {
                bookingId,
                guestId,
                credentialId,
                credential,
                intendedEmail: delivery.intendedEmail,
                expiresAt,
              });
        return {
          credentialId,
          revision: input.expectedRevision + 1,
          expiresAt: expiresAt.toISOString(),
          ...(notificationIntentId === undefined ? {} : { notificationIntentId }),
        };
      },
    );
    // Raw credential exists only in this request. Durable retries cannot recover it.
    return {
      ...result,
      ...(delivery === undefined && credential !== undefined ? { credential } : {}),
    };
  }
  private async publication(bookingId: string, publicInvitationId?: string) {
    if (this.guests.owners.invitation === undefined) throw unavailable();
    try {
      return await this.guests.owners.invitation.getCurrent(bookingId, publicInvitationId);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) throw unavailable();
      throw error;
    }
  }
  private async read<T>(
    hash: string,
    kind: 'CREDENTIAL' | 'SESSION',
    work: (
      tx: Prisma.TransactionClient,
      credential: GuestInvitationCredential,
      greeting: string,
    ) => Promise<T>,
  ) {
    const prisma = this.guests.repository.prisma;
    const reference =
      kind === 'CREDENTIAL'
        ? await prisma.guestInvitationCredential.findUnique({ where: { tokenHash: hash } })
        : await prisma.guestInvitationSession
            .findUnique({ where: { tokenHash: hash } })
            .then(async (session) =>
              session === null
                ? null
                : prisma.guestInvitationCredential.findUnique({
                    where: { id: session.credentialId },
                  }),
            );
    if (reference === null) throw unavailable();
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference.bookingId}::text))`;
      // Also serialize with legacy Booking lifecycle writers that use row locks.
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id=${reference.bookingId}::uuid FOR SHARE`;
      const credential = await tx.guestInvitationCredential.findUniqueOrThrow({
        where: { id: reference.id },
      });
      const now = this.guests.now();
      if (credential.revokedAt !== null || credential.expiresAt <= now) throw unavailable();
      if (kind === 'SESSION') {
        const session = await tx.guestInvitationSession.findUnique({ where: { tokenHash: hash } });
        if (session === null || session.expiresAt <= now || session.credentialId !== credential.id)
          throw unavailable();
      }
      const guest = await tx.guest.findFirst({
        where: { id: credential.guestId, bookingId: credential.bookingId, status: 'ACTIVE' },
      });
      if (guest === null) throw unavailable();
      try {
        await this.guests.owners.planning.requireInvitationViewContext(credential.bookingId);
      } catch (error) {
        if (error instanceof AppError && error.status === 404) throw unavailable();
        throw error;
      }
      return work(tx, credential, guest.name);
    });
  }
  async exchange(value: string, resolvedIp: string) {
    // Count invalid tokens too, and never store/log IP or the raw token.
    await this.rateLimit(digest({ ip: resolvedIp }));
    await this.rateLimit(digest({ ip: resolvedIp, fingerprint: tokenHash(value) }));
    if (!/^wgc_[A-Za-z0-9_-]{43}$/u.test(value)) throw unavailable();
    return this.read(tokenHash(value), 'CREDENTIAL', async (tx, credential) => {
      await this.publication(credential.bookingId, credential.publicInvitationId);
      const capability = `wgs_${randomBytes(32).toString('base64url')}`;
      const expiresAt = new Date(
        Math.min(this.guests.now().getTime() + 15 * 60000, credential.expiresAt.getTime()),
      );
      await tx.guestInvitationSession.create({
        data: { tokenHash: tokenHash(capability), credentialId: credential.id, expiresAt },
      });
      return { capability, expiresAt: expiresAt.toISOString() };
    });
  }
  async view(value: string) {
    if (!/^wgs_[A-Za-z0-9_-]{43}$/u.test(value)) throw unavailable();
    return this.read(tokenHash(value), 'SESSION', async (_tx, credential, greeting) => ({
      recipientGreeting: greeting,
      invitation: await this.publication(credential.bookingId, credential.publicInvitationId),
    }));
  }
  private async rateLimit(key: string) {
    const now = this.guests.now();
    const rows = await this.guests.repository.prisma.$queryRaw<Array<{ attempts: number }>>`
      INSERT INTO "GuestExchangeLimit" (key, attempts, "expiresAt") VALUES (${key},1,${new Date(now.getTime() + 15 * 60000)})
      ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN "GuestExchangeLimit"."expiresAt"<=${now} THEN 1 ELSE "GuestExchangeLimit".attempts+1 END,
        "expiresAt"=CASE WHEN "GuestExchangeLimit"."expiresAt"<=${now} THEN EXCLUDED."expiresAt" ELSE "GuestExchangeLimit"."expiresAt" END
      RETURNING attempts`;
    if (rows[0]!.attempts > 10)
      throw new AppError({
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many invitation exchanges.',
        headers: { 'Retry-After': '900' },
      });
  }
}
