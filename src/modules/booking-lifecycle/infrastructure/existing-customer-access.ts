import { Prisma } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';

type LinkableCustomer = Readonly<{ accountId: string; sourceConsultationId: string }>;

/** Only an active customer already granted access under this Manager is linkable. */
export async function findLinkableCustomer(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>,
  managerAccountId: string,
  emailNormalized: string,
  targetConsultationId: string,
  lock = false,
): Promise<LinkableCustomer | null> {
  const rows = await database.$queryRaw<LinkableCustomer[]>(Prisma.sql`
    SELECT a."id" AS "accountId", c."id" AS "sourceConsultationId"
    FROM "Consultation" c
    JOIN "ConsultationAccess" ca ON ca."consultationId" = c."id"
    JOIN "Account" a ON a."id" = ca."accountId"
    JOIN "PasswordCredential" p ON p."accountId" = a."id"
    WHERE c."managerAccountId" = ${managerAccountId}::uuid
      AND c."intendedEmailNormalized" = ${emailNormalized}
      AND a."emailNormalized" = ${emailNormalized} AND a."status" = 'ACTIVE'
      AND c."id" <> ${targetConsultationId}::uuid
    ORDER BY c."createdAt" DESC, c."id" DESC LIMIT 1
    ${lock ? Prisma.sql`FOR SHARE OF c, ca, a, p` : Prisma.empty}
  `);
  return rows[0] ?? null;
}

export async function linkExistingCustomer(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    consultationId: string;
    sourceConsultationId: string;
    managerAccountId: string;
    emailNormalized: string;
    requestId: string;
  }>,
) {
  const source = await transaction.consultation.findFirst({
    where: {
      id: input.sourceConsultationId,
      managerAccountId: input.managerAccountId,
      intendedEmailNormalized: input.emailNormalized,
    },
    select: { id: true },
  });
  if (!source || source.id === input.consultationId)
    throw new AppError({
      status: 409,
      code: 'CUSTOMER_SELECTION_STALE',
      message: 'Select the existing customer again before linking this consultation.',
    });
  const customer = await findLinkableCustomer(
    transaction,
    input.managerAccountId,
    input.emailNormalized,
    input.consultationId,
    true,
  );
  // Reused contacts without a usable account still follow normal invitation acceptance.
  if (!customer) return null;
  const created = await transaction.consultationAccess.createMany({
    data: {
      accountId: customer.accountId,
      consultationId: input.consultationId,
      level: 'RESTRICTED',
    },
    skipDuplicates: true,
  });
  await transaction.accountRole.upsert({
    where: { accountId_role: { accountId: customer.accountId, role: 'COUPLE' } },
    create: { accountId: customer.accountId, role: 'COUPLE' },
    update: {},
  });
  if (created.count > 0) {
    await transaction.workspaceInvitation.updateMany({
      where: { consultationId: input.consultationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await transaction.auditLog.create({
      data: {
        requestId: input.requestId,
        actorType: 'USER',
        actorId: input.managerAccountId,
        action: 'consultation.existing-customer-linked',
        entityType: 'consultation',
        entityId: input.consultationId,
        metadata: {
          sourceConsultationId: customer.sourceConsultationId,
          accessLevel: 'RESTRICTED',
        },
      },
    });
  }
  return { linked: true as const };
}
