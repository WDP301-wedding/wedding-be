import { z } from 'zod';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type {
  InvitationTemplateSelectionReader,
  TemplateSelectionReference,
} from '../application/template-selection.port.js';
import { designContentSchema, id } from '../domain/studio-policy.js';

const selectionPageSchema = z
  .array(z.strictObject({ templateId: id, templateVersionId: id }))
  .max(50);
const factsSchema = z.strictObject({
  templateId: id,
  templateVersionId: id,
  revision: z.int().positive(),
  title: designContentSchema.shape.title,
});

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
    async findSelectableSelections(inputs: readonly TemplateSelectionReference[]) {
      const requests = selectionPageSchema.parse(inputs);
      if (requests.length === 0) return Object.freeze([]);
      const templateIds = [...new Set(requests.map((row) => row.templateId))].sort();
      const ids = Prisma.join(templateIds.map((templateId) => Prisma.sql`${templateId}::uuid`));
      // Lock each distinct head once, in a stable order, before reading current facts.
      await prisma.$queryRaw(Prisma.sql`
        SELECT "id" FROM "InvitationTemplate" WHERE "id" IN (${ids}) ORDER BY "id" FOR SHARE
      `);
      const rows = await prisma.$queryRaw(Prisma.sql`
        SELECT head."id" AS "templateId", version."id" AS "templateVersionId",
               version."revision", version."content" -> 'title' AS "title"
        FROM "InvitationTemplate" AS head
        JOIN "InvitationTemplateVersion" AS version
          ON version."id" = head."currentVersionId"
         AND version."templateId" = head."id" AND version."revision" = head."revision"
        WHERE head."id" IN (${ids}) AND head."active" = true
        ORDER BY head."id"
      `);
      const requested = new Set(
        requests.map((row) => `${row.templateId}/${row.templateVersionId}`),
      );
      return Object.freeze(
        z
          .array(factsSchema)
          .parse(rows)
          .filter((row) => requested.has(`${row.templateId}/${row.templateVersionId}`))
          .map((row) => Object.freeze(row)),
      );
    },
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
    findSelectableSelections: (
      inputs: Parameters<InvitationTemplateSelectionReader['findSelectableSelections']>[0],
    ) =>
      prisma.$transaction((tx) =>
        createInvitationTemplateSelectionReader(tx).findSelectableSelections(inputs),
      ),
    requireSelection: (
      input: Parameters<InvitationTemplateSelectionReader['requireSelection']>[0],
    ) =>
      prisma.$transaction((tx) =>
        createInvitationTemplateSelectionReader(tx).requireSelection(input),
      ),
  });
}
