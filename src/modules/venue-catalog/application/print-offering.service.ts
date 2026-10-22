import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../../core/errors/app-error.js';
import {
  Prisma,
  type PrismaClient,
  type PrintOfferingRevision,
} from '../../../generated/prisma/client.js';
import type { InvitationTemplateSelectionReader } from '../../invitation-studio/application/template-selection.port.js';
import type { CatalogMutationContext } from '../infrastructure/catalog-version.repository.js';
import {
  checkedLineTotal,
  createPrintOfferingSchema,
  revisePrintOfferingSchema,
  printSelectionSchema,
} from '../domain/commercial-offering.js';
import { offeringConflict } from './restaurant-service.service.js';

type TemplateReaderFactory = (
  client: Prisma.TransactionClient,
) => InvitationTemplateSelectionReader;
function view(row: PrintOfferingRevision, restaurantId: string) {
  return Object.freeze({
    offeringId: row.offeringId,
    sourceRevisionId: row.id,
    restaurantId,
    revision: row.revision,
    name: row.name,
    printType: row.printType,
    material: row.material,
    templateId: row.templateId,
    templateVersionId: row.templateVersionId,
    templateTitle: row.templateTitle,
    unit: 'copy' as const,
    unitPriceVnd: row.unitPriceVnd.toNumber(),
    active: row.active,
  });
}
export type PrintSelectionFacts = ReturnType<typeof view> & {
  quantity: number;
  lineTotalVnd: number;
};
export function createPrintOfferingService(prisma: PrismaClient, templates: TemplateReaderFactory) {
  async function templateTitle(
    tx: Prisma.TransactionClient,
    input: { templateId: string; templateVersionId: string; active: boolean },
  ) {
    const facts = input.active
      ? await templates(tx).requireSelection(input)
      : await templates(tx).resolveVersion(input.templateVersionId);
    if (facts.templateId !== input.templateId) throw offeringConflict('OFFERING_NOT_SELECTABLE');
    return facts.title;
  }
  return Object.freeze({
    create(value: unknown, context: CatalogMutationContext) {
      const input = createPrintOfferingSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        const title = await templateTitle(tx, input);
        const restaurant = await tx.restaurantProfile.findUniqueOrThrow({
          where: { singletonKey: 'RESTAURANT' },
        });
        const offeringId = randomUUID();
        await tx.printOffering.create({
          data: { id: offeringId, restaurantId: restaurant.id, revision: 1, active: input.active },
        });
        const row = await tx.printOfferingRevision.create({
          data: {
            id: randomUUID(),
            offeringId,
            revision: 1,
            ...input,
            templateTitle: title,
            actorId: context.actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.print-offering-created',
            entityType: 'print-offering',
            entityId: offeringId,
            metadata: { revision: 1, sourceRevisionId: row.id },
          },
        });
        return view(row, restaurant.id);
      });
    },
    revise(offeringId: string, value: unknown, context: CatalogMutationContext) {
      const { expectedRevision, ...input } = revisePrintOfferingSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PrintOffering" WHERE "id" = ${offeringId}::uuid FOR UPDATE`;
        const head = await tx.printOffering.findUnique({ where: { id: offeringId } });
        if (head === null) throw new NotFoundError();
        if (head.revision !== expectedRevision)
          throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
        const title = await templateTitle(tx, input);
        const revision = expectedRevision + 1;
        const row = await tx.printOfferingRevision.create({
          data: {
            id: randomUUID(),
            offeringId,
            revision,
            ...input,
            templateTitle: title,
            actorId: context.actorId,
          },
        });
        await tx.printOffering.update({
          where: { id: offeringId },
          data: { revision, active: input.active },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorType: 'USER',
            actorId: context.actorId,
            action: 'venue.print-offering-revised',
            entityType: 'print-offering',
            entityId: offeringId,
            metadata: { predecessorRevision: expectedRevision, revision, sourceRevisionId: row.id },
          },
        });
        return view(row, head.restaurantId);
      });
    },
    list(includeArchived = false, cursor?: string, limit = 20) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.printOffering.findMany({
          where: {
            ...(includeArchived ? {} : { active: true }),
            ...(cursor === undefined ? {} : { id: { gt: cursor } }),
          },
          orderBy: { id: 'asc' },
          take: limit + 1,
          include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
        });
        const page = rows.slice(0, limit);
        const eligible = includeArchived
          ? []
          : await templates(tx).findSelectableSelections(
              page
                .filter((head) => head.revisions[0]!.active)
                .map((head) => ({
                  templateId: head.revisions[0]!.templateId,
                  templateVersionId: head.revisions[0]!.templateVersionId,
                })),
            );
        const selectable = new Set(
          eligible.map((row) => `${row.templateId}/${row.templateVersionId}`),
        );
        const items = page
          .filter((head) => {
            const row = head.revisions[0]!;
            return (
              includeArchived ||
              (row.active && selectable.has(`${row.templateId}/${row.templateVersionId}`))
            );
          })
          .map((head) => view(head.revisions[0]!, head.restaurantId));
        return { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
      });
    },
    async resolveRevision(sourceRevisionId: string) {
      const row = await prisma.printOfferingRevision.findUnique({
        where: { id: sourceRevisionId },
        include: { offering: true },
      });
      if (row === null) throw new NotFoundError();
      return view(row, row.offering.restaurantId);
    },
    requireBatchSelections(values: readonly unknown[]): Promise<Map<string, PrintSelectionFacts>> {
      if (values.length === 0) return Promise.resolve(new Map<string, PrintSelectionFacts>());
      const parsed = values.map((v) => printSelectionSchema.parse(v));
      const sortedInputs = [...parsed].sort((a, b) => a.offeringId.localeCompare(b.offeringId));
      const offeringIds = [...new Set(sortedInputs.map((i) => i.offeringId))];
      const ids = Prisma.join(offeringIds.map((id) => Prisma.sql`${id}::uuid`));
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "PrintOffering" WHERE "id" IN (${ids}) ORDER BY "id" FOR SHARE
        `);
        const heads = await tx.printOffering.findMany({
          where: { id: { in: offeringIds } },
          include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
        });
        const headMap = new Map(heads.map((h) => [h.id, h]));
        const templateReader = templates(tx);
        const activeRows = heads
          .filter((h) => h.active && h.revisions.length > 0)
          .map((h) => h.revisions[0]!);
        const distinctRefs = [
          ...new Map(
            activeRows.map((r) => [
              `${r.templateId}/${r.templateVersionId}`,
              { templateId: r.templateId, templateVersionId: r.templateVersionId },
            ]),
          ).values(),
        ];
        const selectableTemplates = await templateReader.findSelectableSelections(distinctRefs);
        const selectableSet = new Set(
          selectableTemplates.map((t) => `${t.templateId}/${t.templateVersionId}`),
        );
        const result = new Map<
          string,
          ReturnType<typeof view> & { quantity: number; lineTotalVnd: number }
        >();
        for (const input of sortedInputs) {
          const head = headMap.get(input.offeringId);
          if (head === null || head === undefined || !head.active)
            throw offeringConflict('OFFERING_NOT_SELECTABLE');
          const row = head.revisions[0];
          if (!row || row.id !== input.sourceRevisionId)
            throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
          if (!selectableSet.has(`${row.templateId}/${row.templateVersionId}`)) {
            await templateReader.requireSelection(row);
          }
          const facts = view(row, head.restaurantId);
          result.set(
            input.offeringId,
            Object.freeze({
              ...facts,
              quantity: input.quantity,
              lineTotalVnd: checkedLineTotal(facts.unitPriceVnd, input.quantity),
            }),
          );
        }
        return result;
      });
    },
    requireSelection(value: unknown) {
      const input = printSelectionSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PrintOffering" WHERE "id" = ${input.offeringId}::uuid FOR SHARE`;
        const head = await tx.printOffering.findUnique({
          where: { id: input.offeringId },
          include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
        });
        if (head === null || !head.active) throw offeringConflict('OFFERING_NOT_SELECTABLE');
        const row = head.revisions[0]!;
        if (row.id !== input.sourceRevisionId)
          throw offeringConflict('COMMERCIAL_PRICE_REVISION_STALE');
        await templates(tx).requireSelection(row);
        const facts = view(row, head.restaurantId);
        return Object.freeze({
          ...facts,
          quantity: input.quantity,
          lineTotalVnd: checkedLineTotal(facts.unitPriceVnd, input.quantity),
        });
      });
    },
  });
}
export type PrintOfferingReader = Pick<
  ReturnType<typeof createPrintOfferingService>,
  'requireSelection' | 'requireBatchSelections' | 'resolveRevision'
>;
export function createPrintOfferingReader(
  prisma: PrismaClient,
  templates: TemplateReaderFactory,
): PrintOfferingReader {
  const service = createPrintOfferingService(prisma, templates);
  return Object.freeze({
    requireSelection: service.requireSelection,
    requireBatchSelections: service.requireBatchSelections,
    resolveRevision: service.resolveRevision,
  });
}
