import { z } from 'zod';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { InvitationTemplateSelectionReader } from '../application/template-selection.port.js';
import { designContentSchema } from '../domain/studio-policy.js';

export function createInvitationTemplateSelectionReader(
  prisma: Pick<
    Prisma.TransactionClient,
    'invitationTemplate' | 'invitationTemplateVersion' | '$queryRaw'
  >,
): InvitationTemplateSelectionReader {
  const titleSchema = z.object({ title: designContentSchema.shape.title });
  async function resolveVersion(templateVersionId: string) {
    const row = await prisma.invitationTemplateVersion.findUnique({
      where: { id: z.uuid().parse(templateVersionId) },
    });
    if (row === null) throw new NotFoundError();
    return Object.freeze({
      templateId: row.templateId,
      templateVersionId: row.id,
      revision: row.revision,
      title: titleSchema.parse(row.content).title,
    });
  }
  return Object.freeze({
    resolveVersion,
    async requireSelection(input: Readonly<{ templateId: string; templateVersionId: string }>) {
      const templateId = z.uuid().parse(input.templateId);
      await prisma.$queryRaw`SELECT "id" FROM "InvitationTemplate" WHERE "id" = ${templateId}::uuid FOR SHARE`;
      const head = await prisma.invitationTemplate.findUnique({ where: { id: templateId } });
      if (head === null || !head.active)
        throw new AppError({
          status: 409,
          code: 'OFFERING_NOT_SELECTABLE',
          message: 'The invitation template is not selectable.',
        });
      if (head.currentVersionId !== input.templateVersionId)
        throw new AppError({
          status: 409,
          code: 'COMMERCIAL_PRICE_REVISION_STALE',
          message: 'The invitation template revision changed.',
        });
      const facts = await resolveVersion(input.templateVersionId);
      if (facts.templateId !== head.id || facts.revision !== head.revision)
        throw new NotFoundError();
      return facts;
    },
  });
}

// Standalone callers get the same lock lifetime as Venue's enlisted transaction.
export function createInvitationTemplateSelectionProvider(
  prisma: PrismaClient,
): InvitationTemplateSelectionReader {
  const reader = createInvitationTemplateSelectionReader(prisma);
  return Object.freeze({
    resolveVersion: (templateVersionId: string) => reader.resolveVersion(templateVersionId),
    requireSelection: (
      input: Parameters<InvitationTemplateSelectionReader['requireSelection']>[0],
    ) =>
      prisma.$transaction((tx) =>
        createInvitationTemplateSelectionReader(tx).requireSelection(input),
      ),
  });
}
