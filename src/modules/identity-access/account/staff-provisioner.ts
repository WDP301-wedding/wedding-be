import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import {
  NotFoundError,
  IdempotencyKeyReusedError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { AuthenticatedActorResolver } from '../authorization/authenticated-actor.middleware.js';
import { normalizeEmail } from './account.service.js';
import type {
  StaffAccountProvisioner,
  StaffProvisioningContext as StaffRequestContext,
} from './staff-provisioner.contracts.js';
import {
  canonicalizeRequest,
  hashCanonicalRequest as digest,
} from '../../../core/idempotency/request-hash.js';

/** Identity owns the account/role/session writes. Assignment reconciliation is
 * enlisted by Staff infrastructure so disable is one atomic command. */
export function createStaffAccountProvisioner(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
  revokeAssignments: (
    tx: Prisma.TransactionClient,
    accountId: string,
    context: StaffRequestContext,
    reason: string,
  ) => Promise<void>,
  now: () => Date,
): StaffAccountProvisioner {
  async function run<T>(
    action: string,
    payload: unknown,
    keyValue: string,
    context: StaffRequestContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const parsedKey = idempotencyKeySchema.safeParse(keyValue);
    if (!parsedKey.success) throw new InvalidIdempotencyKeyError();
    const key = parsedKey.data,
      intentDigest = digest({ actorId: context.actorId, action, key }),
      commandDigest = digest(payload);
    return prisma.$transaction(
      async (tx) => {
        // Lock current authority in the same order as session revocation writers.
        const actor = await resolver.resolve(context.accessToken);
        if (actor.accountId !== context.actorId || !actor.roles.includes('MANAGER'))
          throw new NotFoundError();
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.accountId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "AccountRole" WHERE "accountId"=${actor.accountId}::uuid ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${actor.sessionId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "AccessCredential" WHERE "sessionId"=${actor.sessionId}::uuid ORDER BY id FOR SHARE`;
        const current = await resolver.resolve(context.accessToken);
        if (!current.roles.includes('MANAGER')) throw new NotFoundError();
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intentDigest}))`;
        const prior = await tx.identityStaffCommand.findUnique({ where: { intentDigest } });
        if (prior !== null) {
          if (prior.commandDigest !== commandDigest) throw new IdempotencyKeyReusedError();
          return prior.result as T;
        }
        const result = await work(tx);
        await tx.identityStaffCommand.create({
          data: {
            intentDigest,
            commandDigest,
            result: JSON.parse(canonicalizeRequest(result)) as Prisma.InputJsonValue,
          },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
  async function target(tx: Prisma.TransactionClient, accountId: string) {
    // Managers cannot target each other (or themselves) for operational role changes.
    const initial = await tx.account.findUnique({
      where: { id: accountId },
      include: { roles: true },
    });
    if (initial === null || initial.roles.some((r) => r.role === 'MANAGER'))
      throw new NotFoundError();
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${accountId}::uuid FOR UPDATE`;
    const row = await tx.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { passwordCredential: true, roles: true },
    });
    if (row.status !== 'ACTIVE' || row.roles.some((r) => r.role === 'MANAGER'))
      throw new NotFoundError();
    return row;
  }
  async function audit(
    tx: Prisma.TransactionClient,
    accountId: string,
    action: string,
    context: StaffRequestContext,
  ) {
    await tx.auditLog.create({
      data: {
        requestId: context.requestId,
        actorType: 'USER',
        actorId: context.actorId,
        action,
        entityType: 'ACCOUNT',
        entityId: accountId,
        metadata: {},
      },
    });
  }
  return {
    provision(emailValue, key, context) {
      const email = normalizeEmail(emailValue);
      return run('staff.provision', { email: email.normalized }, key, context, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff-email:${email.normalized}`}))`;
        const account = await tx.account.upsert({
          where: { emailNormalized: email.normalized },
          update: {},
          create: { emailNormalized: email.normalized, displayEmail: email.display },
        });
        const row = await target(tx, account.id);
        await tx.accountRole.upsert({
          where: { accountId_role: { accountId: row.id, role: 'STAFF' } },
          create: { accountId: row.id, role: 'STAFF' },
          update: {},
        });
        await audit(tx, row.id, 'identity.staff-provisioned', context);
        return { accountId: row.id, credentialSetupRequired: row.passwordCredential === null };
      });
    },
    setOperationalAccess(accountId, input, key, context) {
      return run(`staff.operational-access:${accountId}`, input, key, context, async (tx) => {
        await target(tx, accountId);
        if (input.enabled)
          await tx.accountRole.upsert({
            where: { accountId_role: { accountId, role: 'STAFF' } },
            create: { accountId, role: 'STAFF' },
            update: {},
          });
        else {
          await tx.accountRole.deleteMany({ where: { accountId, role: 'STAFF' } });
          const at = now();
          await tx.session.updateMany({
            where: { accountId, status: 'ACTIVE' },
            data: {
              status: 'REVOKED',
              revokedAt: at,
              revocationReason: 'staff-operational-access-disabled',
            },
          });
          await tx.accessCredential.updateMany({
            where: { session: { accountId }, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: at },
          });
          await tx.refreshCredential.updateMany({
            where: { session: { accountId }, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: at },
          });
          await revokeAssignments(tx, accountId, context, input.reason);
        }
        await audit(
          tx,
          accountId,
          input.enabled ? 'identity.staff-enabled' : 'identity.staff-disabled',
          context,
        );
        return { accountId, enabled: input.enabled };
      });
    },
  };
}
