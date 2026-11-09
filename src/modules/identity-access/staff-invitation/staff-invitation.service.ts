import type { Prisma, PrismaClient, StaffInvitation } from '../../../generated/prisma/client.js';
import { AppError, RateLimitError } from '../../../core/errors/app-error.js';
import {
  createEmailIntentIdempotencyKey,
  EmailRequestRejectedError,
  type EmailProvider,
} from '../../../integrations/email/email-provider.js';
import { hashOpaqueToken, issueOpaqueToken } from '../crypto/token.js';
import type { PasswordCrypto } from '../account/account.service.js';
import { maskEmail } from '../workspace-invitation/workspace-invitation.acceptance.js';
import { staffInvitationToken } from './staff-invitation.schemas.js';

type Delivery = { invitationId: string; recipientEmail: string; token: string };
export type StaffInvitationDelivery = Readonly<{
  emailProvider: EmailProvider;
  manageWebOrigin: string;
}>;

export function invitationSummary(row: StaffInvitation, now: Date) {
  return {
    invitationId: row.id,
    status:
      row.status === 'ACTIVE'
        ? row.expiresAt <= now
          ? 'EXPIRED'
          : 'PENDING'
        : row.status === 'ACCEPTED'
          ? 'ACCEPTED'
          : 'REVOKED',
    deliveryStatus: row.deliveryStatus,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Tokens exist only in the issuing request and email, never in durable command results. */
export function createStaffInvitationIssuer(
  prisma: PrismaClient,
  delivery: StaffInvitationDelivery,
  now: () => Date,
) {
  const origin = new URL(delivery.manageWebOrigin);
  if (
    origin.origin !== delivery.manageWebOrigin ||
    (origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      ))
  )
    throw new TypeError('Staff invitations require a trusted HTTPS Manager Web origin.');
  return {
    async prepare(
      tx: Prisma.TransactionClient,
      account: { id: string; displayEmail: string },
      actorId: string,
      requestId: string,
    ): Promise<Delivery> {
      const at = now();
      const recent = await tx.staffInvitation.findMany({
        where: { accountId: account.id, createdAt: { gt: new Date(at.getTime() - 86400_000) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent[0] && recent[0].createdAt.getTime() + 60_000 > at.getTime())
        throw new RateLimitError(
          Math.ceil((recent[0].createdAt.getTime() + 60_000 - at.getTime()) / 1000),
        );
      if (recent.length >= 3) throw new RateLimitError(86400);
      await tx.staffInvitation.updateMany({
        where: { accountId: account.id, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      });
      const token = issueOpaqueToken('staff-invitation', 32);
      const row = await tx.staffInvitation.create({
        data: {
          accountId: account.id,
          issuedByAccountId: actorId,
          tokenHash: token.tokenHash,
          expiresAt: new Date(at.getTime() + 72 * 3600_000),
          createdAt: at,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId,
          actorType: 'USER',
          actorId,
          action: 'identity.staff-invitation-issued',
          entityType: 'staff-invitation',
          entityId: row.id,
          metadata: {},
        },
      });
      return { invitationId: row.id, recipientEmail: account.displayEmail, token: token.token };
    },
    async dispatch(command: Delivery) {
      const link = new URL('/staff-invitation', origin);
      link.hash = command.token;
      // UNKNOWN is persisted before the external effect. A crash/timeout must never
      // cause automatic resend of an ambiguous send. Explicit reissue rotates the token.
      let status = 'ACCEPTED';
      try {
        await delivery.emailProvider.send({
          idempotencyKey: createEmailIntentIdempotencyKey({
            entityId: command.invitationId,
            intentType: 'staff-invitation',
          }),
          to: [command.recipientEmail],
          subject: 'Lời mời tham gia nhân sự Hỷ Yến',
          text: `Bạn được mời tham gia nhân sự nhà hàng Hỷ Yến.\nMở liên kết để thiết lập tài khoản hoặc xác nhận bằng mật khẩu hiện có:\n${link.toString()}\nLiên kết có hiệu lực 72 giờ và chỉ dùng một lần. Nếu bạn không mong đợi lời mời này, hãy bỏ qua thư.`,
          html: `<p>Bạn được mời tham gia nhân sự nhà hàng Hỷ Yến.</p><p><a href="${link.toString()}">Thiết lập tài khoản nhân viên</a></p><p>Liên kết có hiệu lực 72 giờ và chỉ dùng một lần. Nếu đã có mật khẩu, hãy dùng mật khẩu hiện tại để nhận lời mời.</p><p>Nếu bạn không mong đợi lời mời này, hãy bỏ qua thư.</p>`,
        });
      } catch (error) {
        status = error instanceof EmailRequestRejectedError ? 'FAILED' : 'UNKNOWN';
      }
      await prisma.staffInvitation.update({
        where: { id: command.invitationId },
        data: { deliveryStatus: status },
      });
    },
    async summary(invitationId: string) {
      return invitationSummary(
        await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitationId } }),
        now(),
      );
    },
  };
}
export type StaffInvitationIssuer = ReturnType<typeof createStaffInvitationIssuer>;

export function createStaffInvitationAcceptance(
  prisma: PrismaClient,
  crypto: PasswordCrypto,
  now: () => Date = () => new Date(),
) {
  const invalid = () =>
    new AppError({
      status: 422,
      code: 'STAFF_INVITATION_INVALID_OR_EXPIRED',
      message: 'Lời mời không hợp lệ, đã hết hạn hoặc đã được sử dụng.',
    });
  async function preview(token: string) {
    if (!staffInvitationToken.safeParse(token).success) throw invalid();
    const row = await prisma.staffInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(token, 'staff-invitation') },
      include: { account: { include: { passwordCredential: true, roles: true } } },
    });
    if (
      !row ||
      row.status !== 'ACTIVE' ||
      row.expiresAt <= now() ||
      row.account.status !== 'ACTIVE' ||
      row.account.roles.some((r) => r.role === 'MANAGER')
    )
      throw invalid();
    return row;
  }
  return {
    async details(token: string) {
      const row = await preview(token);
      return {
        maskedEmail: maskEmail(row.account.displayEmail),
        hasExistingPassword: row.account.passwordCredential !== null,
        expiresAt: row.expiresAt.toISOString(),
      };
    },
    async accept(token: string, password: string, requestId: string) {
      const candidate = await preview(token);
      return prisma.$transaction(
        async (tx) => {
          // Same account-first order as provisioning, password writes and disable.
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${candidate.accountId}::uuid FOR UPDATE`;
          const row = await tx.staffInvitation.findUniqueOrThrow({
            where: { id: candidate.id },
            include: { account: { include: { passwordCredential: true, roles: true } } },
          });
          if (
            row.status !== 'ACTIVE' ||
            row.expiresAt <= now() ||
            row.account.status !== 'ACTIVE' ||
            row.account.roles.some((r) => r.role === 'MANAGER')
          )
            throw invalid();
          const previous = row.account.passwordCredential;
          if (previous) {
            const check = await crypto.verify(password, {
              algorithm: previous.algorithm,
              version: previous.version,
              saltEncoded: previous.saltEncoded,
              derivedKeyEncoded: previous.derivedKeyEncoded,
              parameters: {
                cost: previous.cost,
                blockSize: previous.blockSize,
                parallelization: previous.parallelization,
                keyLengthBytes: previous.keyLengthBytes,
                maxMemoryBytes: previous.maxMemoryBytes,
              },
            });
            if (!check.matches) throw invalid();
          } else {
            const verifier = await crypto.hash(password);
            await tx.passwordCredential.create({
              data: {
                accountId: row.accountId,
                algorithm: verifier.algorithm,
                version: verifier.version,
                ...verifier.parameters,
                saltEncoded: verifier.saltEncoded,
                derivedKeyEncoded: verifier.derivedKeyEncoded,
              },
            });
          }
          await tx.accountRole.upsert({
            where: { accountId_role: { accountId: row.accountId, role: 'STAFF' } },
            create: { accountId: row.accountId, role: 'STAFF' },
            update: {},
          });
          await tx.staffInvitation.update({
            where: { id: row.id },
            data: { status: 'ACCEPTED', acceptedAt: now() },
          });
          await tx.auditLog.create({
            data: {
              requestId,
              actorType: 'USER',
              actorId: row.accountId,
              action: 'identity.staff-invitation-accepted',
              entityType: 'staff-invitation',
              entityId: row.id,
              metadata: { initialPasswordSetup: previous === null },
            },
          });
          return {
            accepted: true as const,
            email: row.account.displayEmail,
            requiresLogin: true as const,
          };
        },
        { timeout: 30000 },
      );
    },
  };
}
