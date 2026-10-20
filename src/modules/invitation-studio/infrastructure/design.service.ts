import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import {
  designContentSchema,
  designViewSchema,
  id,
  parseStudio,
  revision,
  studioConflict,
  textFieldsSchema,
  type DesignContent,
} from '../domain/studio-policy.js';
import { asJson, type StudioRepository } from './studio.repository.js';
import { type StudioAuthorization } from './studio-authorization.js';
import { studioPhase } from './studio-phase.js';

const createSchema = z
  .strictObject({
    bookingId: id,
    templateId: id.optional(),
    templateVersionId: id.optional(),
    content: designContentSchema.optional(),
    idempotencyKey: z.string(),
  })
  .refine(
    (value) =>
      (value.templateId === undefined) !== (value.content === undefined) &&
      (value.templateVersionId === undefined || value.templateId !== undefined),
  );
const editSchema = z
  .strictObject({
    bookingId: id,
    designId: id,
    expectedRevision: revision,
    content: designContentSchema.optional(),
    textFields: textFieldsSchema.optional(),
    idempotencyKey: z.string(),
  })
  .refine((value) => (value.content === undefined) !== (value.textFields === undefined));
const templateSchema = z.strictObject({
  templateId: id,
  expectedRevision: z.int().nonnegative(),
  active: z.boolean(),
  content: designContentSchema,
  idempotencyKey: z.string(),
});
const pageSchema = z.strictObject({
  cursor: id.optional(),
  limit: z.int().min(1).max(100).default(20),
  bookingId: id.optional(),
  includeArchived: z.boolean().default(false),
});

export class DesignService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly now: () => Date = () => new Date(),
    readonly contractedTemplate?: {
      requireTemplate(
        client: Prisma.TransactionClient,
        bookingId: string,
        templateVersionId: string,
      ): Promise<void>;
    },
  ) {}
  async saveTemplate(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(templateSchema, value);
    if (input.content.derivedAssetIds.length !== 0) throw new ValidationError();
    return this.repository.command(
      input.templateId,
      context,
      input.idempotencyKey,
      { action: 'template.save', ...input },
      (ctx) => this.access.manager(ctx),
      async (tx, scoped) => {
        const prior = await tx.invitationTemplate.findUnique({ where: { id: input.templateId } });
        if ((prior?.revision ?? 0) !== input.expectedRevision)
          throw studioConflict('INVITATION_TEMPLATE_STALE');
        const versionId = randomUUID(),
          number = input.expectedRevision + 1;
        await tx.invitationTemplateVersion.create({
          data: {
            id: versionId,
            templateId: input.templateId,
            revision: number,
            content: asJson(input.content),
          },
        });
        await tx.invitationTemplate.upsert({
          where: { id: input.templateId },
          create: {
            id: input.templateId,
            revision: number,
            currentVersionId: versionId,
            active: input.active,
          },
          update: { revision: number, currentVersionId: versionId, active: input.active },
        });
        await this.repository.audit(
          tx,
          scoped,
          'invitation.template-revised',
          input.templateId,
          number,
        );
        return {
          templateId: input.templateId,
          versionId,
          revisionNumber: number,
          active: input.active,
          ...input.content,
        };
      },
      { action: 'template.save', resourceId: input.templateId },
    );
  }
  async listTemplates(page: unknown, context: MediaRequestContext) {
    const query = parseStudio(pageSchema, page);
    await this.access.templates(query.bookingId, query.includeArchived, context);
    const rows = await this.repository.templatePage(query);
    const heads = rows.slice(0, query.limit);
    const items = heads.map((row) => {
      if (row.versionId !== row.currentVersionId || row.versionTemplateId !== row.id)
        throw new NotFoundError();
      return {
        templateId: row.id,
        versionId: row.versionId,
        revisionNumber: row.revision,
        ...parseStudio(designContentSchema, row.content),
      };
    });
    await this.access.templates(query.bookingId, query.includeArchived, context);
    return { items, nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null };
  }
  async getTemplate(templateValue: string, context: MediaRequestContext, versionValue?: string) {
    await this.access.manager(context);
    const templateId = parseStudio(id, templateValue);
    const head = await this.repository.prisma.invitationTemplate.findUnique({
      where: { id: templateId },
    });
    if (head === null) throw new NotFoundError();
    const versionId =
      versionValue === undefined ? head.currentVersionId : parseStudio(id, versionValue);
    const row = await this.repository.prisma.invitationTemplateVersion.findFirst({
      where: { id: versionId, templateId },
    });
    if (row === null) throw new NotFoundError();
    await this.access.manager(context);
    return {
      templateId,
      versionId: row.id,
      revisionNumber: row.revision,
      active: head.active,
      ...parseStudio(designContentSchema, row.content),
    };
  }
  async list(bookingValue: string, page: unknown, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      query = parseStudio(pageSchema.omit({ bookingId: true, includeArchived: true }), page);
    await studioPhase(context, 'design.list', 'authorization', () =>
      this.access.booking(bookingId, context),
    );
    const rows = await studioPhase(context, 'design.list', 'page', () =>
      this.repository.prisma.invitationDesign.findMany({
        where: { bookingId, ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }) },
        orderBy: { id: 'asc' },
        take: query.limit + 1,
      }),
    );
    const heads = rows.slice(0, query.limit);
    const revisions = await studioPhase(context, 'design.list', 'revisions', () =>
      this.repository.prisma.invitationDesignRevision.findMany({
        where: { bookingId, id: { in: heads.map((row) => row.currentRevisionId) } },
      }),
    );
    const byId = new Map(revisions.map((row) => [row.id, row]));
    const items = heads.map((head) => {
      const row = byId.get(head.currentRevisionId);
      if (row === undefined || row.designId !== head.id) throw new NotFoundError();
      return designViewSchema.parse({
        ...parseStudio(designContentSchema, row.content),
        designId: head.id,
        revisionId: row.id,
        revisionNumber: row.revision,
        updatedAt: row.createdAt.toISOString(),
      });
    });
    // Recheck current authority once for the complete response, including empty pages.
    await studioPhase(context, 'design.list', 'authorization', () =>
      this.access.booking(bookingId, context),
    );
    return { items, nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null };
  }
  async create(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(createSchema, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'design.create', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        if ((await this.access.actor(scoped)).clientKind === 'ANDROID') throw new ValidationError();
        let content = input.content;
        let sourceTemplateVersionId: string | null = null;
        if (input.templateId !== undefined) {
          await tx.$queryRaw`SELECT id FROM "InvitationTemplate" WHERE id=${input.templateId}::uuid FOR SHARE`;
          const template = await tx.invitationTemplate.findUnique({
            where: { id: input.templateId },
          });
          if (template === null || (!template.active && input.templateVersionId === undefined))
            throw new NotFoundError();
          if (input.templateVersionId !== undefined) {
            if (!this.contractedTemplate) throw new ValidationError();
            await this.contractedTemplate.requireTemplate(
              tx,
              input.bookingId,
              input.templateVersionId,
            );
          }
          const source = await tx.invitationTemplateVersion.findFirst({
            where: {
              id: input.templateVersionId ?? template.currentVersionId,
              templateId: template.id,
            },
          });
          if (!source) throw new NotFoundError();
          content = parseStudio(designContentSchema, source.content);
          sourceTemplateVersionId = source.id;
        }
        if (content === undefined) throw new ValidationError();
        await this.requireAssets(tx, input.bookingId, content);
        const designId = randomUUID(),
          revisionId = randomUUID(),
          updatedAt = this.now().toISOString();
        await tx.invitationDesignRevision.create({
          data: {
            id: revisionId,
            designId,
            bookingId: input.bookingId,
            revision: 1,
            content: asJson(content),
            sourceTemplateVersionId,
            createdAt: new Date(updatedAt),
          },
        });
        await tx.invitationDesign.create({
          data: {
            id: designId,
            bookingId: input.bookingId,
            revision: 1,
            currentRevisionId: revisionId,
          },
        });
        await this.repository.audit(tx, scoped, 'invitation.design-created', designId, 1);
        return designViewSchema.parse({
          ...content,
          designId,
          revisionId,
          revisionNumber: 1,
          updatedAt,
        });
      },
      { action: 'design.create' },
    );
  }
  async edit(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(editSchema, value);
    return this.repository.command(
      input.bookingId,
      context,
      input.idempotencyKey,
      { action: 'design.edit', ...input },
      (ctx) => this.access.booking(input.bookingId, ctx, 'COUPLE'),
      async (tx, scoped) => {
        const current = await tx.invitationDesign.findFirst({
          where: { id: input.designId, bookingId: input.bookingId },
        });
        if (current === null) throw new NotFoundError();
        if (current.revision !== input.expectedRevision)
          throw studioConflict('INVITATION_DESIGN_STALE');
        const actor = await this.access.actor(scoped);
        if (actor.clientKind === 'ANDROID' && input.content !== undefined)
          throw new ValidationError();
        const prior = await tx.invitationDesignRevision.findUniqueOrThrow({
          where: { id: current.currentRevisionId },
        });
        const before = parseStudio(designContentSchema, prior.content);
        const content =
          input.content ??
          designContentSchema.parse({
            ...before,
            textFields: { ...before.textFields, ...input.textFields },
          });
        await this.requireAssets(tx, input.bookingId, content);
        const revisionId = randomUUID(),
          number = current.revision + 1,
          updatedAt = this.now().toISOString();
        await tx.invitationDesignRevision.create({
          data: {
            id: revisionId,
            designId: current.id,
            bookingId: input.bookingId,
            revision: number,
            content: asJson(content),
            sourceTemplateVersionId: prior.sourceTemplateVersionId,
            createdAt: new Date(updatedAt),
          },
        });
        await tx.invitationDesign.update({
          where: { id: current.id },
          data: { revision: number, currentRevisionId: revisionId },
        });
        await this.repository.audit(tx, scoped, 'invitation.design-revised', current.id, number);
        return designViewSchema.parse({
          ...content,
          designId: current.id,
          revisionId,
          revisionNumber: number,
          updatedAt,
        });
      },
      { action: 'design.edit', resourceId: input.designId },
    );
  }
  async get(bookingValue: string, designValue: string, context: MediaRequestContext) {
    const bookingId = parseStudio(id, bookingValue),
      designId = parseStudio(id, designValue);
    await this.access.booking(bookingId, context);
    const head = await this.repository.prisma.invitationDesign.findFirst({
      where: { id: designId, bookingId },
    });
    if (head === null) throw new NotFoundError();
    const row = await this.repository.prisma.invitationDesignRevision.findUniqueOrThrow({
      where: { id: head.currentRevisionId },
    });
    await this.access.booking(bookingId, context);
    return designViewSchema.parse({
      ...parseStudio(designContentSchema, row.content),
      designId,
      revisionId: row.id,
      revisionNumber: row.revision,
      updatedAt: row.createdAt.toISOString(),
    });
  }
  private async requireAssets(
    tx: Prisma.TransactionClient,
    bookingId: string,
    content: DesignContent,
  ) {
    if (content.derivedAssetIds.length === 0) return;
    const count = await tx.invitationDerivedAsset.count({
      where: { bookingId, id: { in: content.derivedAssetIds } },
    });
    if (count !== content.derivedAssetIds.length) throw new NotFoundError();
  }
}
