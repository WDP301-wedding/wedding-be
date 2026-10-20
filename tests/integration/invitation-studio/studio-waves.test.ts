import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { nativeTimelineFixture } from './native-booking-fixture.js';
import { createGeneratedAiImage } from '../../../src/integrations/ai-image/ai-image-provider.js';
import { ProviderError, NotFoundError } from '../../../src/core/errors/app-error.js';
import { createStudioRouter } from '../../../src/modules/invitation-studio/http/studio.router.js';
import { createErrorHandler } from '../../../src/core/errors/error-handler.js';
import { digest } from '../../../src/modules/invitation-studio/domain/studio-policy.js';
import {
  designResponse,
  publicationResponse,
  generationPendingResponse,
} from '../../../src/modules/invitation-studio/http/studio.schemas.js';
import { createInvitationStudioServices } from '../../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { AiImageSafetyRefusalError } from '../../../src/integrations/ai-image/ai-image-provider.js';
import { insertDatabaseMedia } from './media-database-fixtures.js';
import { createInvitationEditorReader } from '../../../src/modules/identity-access/authorization/invitation-editor.reader.js';
import { createInvitationStudioRuntime } from '../../../src/modules/invitation-studio/invitation-studio.runtime.js';
import { parseEnvironment } from '../../../src/config/env.js';
import * as aiModule from '../../../src/integrations/ai-image/gemini-ai-image-provider.js';
import * as storageModule from '../../../src/integrations/storage/supabase-storage-provider.js';

const database = new CatalogTestDatabase('isw234');
const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('SPEC-05 W2/W3/W4 native PostgreSQL owner boundaries', () => {
  let f: Awaited<ReturnType<typeof studioFixture>>;
  const provider = { generate: vi.fn() };
  beforeAll(() => database.connect(), 60000);
  afterAll(() => database.disconnect());
  beforeEach(async () => {
    provider.generate.mockReset();
    f = await studioFixture(database.prisma, provider);
    provider.generate.mockResolvedValue(createGeneratedAiImage(f.bytes, 'image/png'));
  });
  const key = () => randomUUID();
  async function design(seating = false) {
    return f.services.designs.create(
      {
        bookingId: f.bookingId,
        content: seating
          ? {
              ...f.content,
              includesSeating: true,
              sections: [
                ...f.content.sections,
                { kind: 'SEATING', textKey: null, derivedAssetId: null },
              ],
            }
          : f.content,
        idempotencyKey: key(),
      },
      f.couple,
    );
  }
  async function publish(d: Awaited<ReturnType<typeof design>>, publicationRevision = 0) {
    return f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: d.designId,
        designRevisionId: d.revisionId,
        expectedRevision: d.revisionNumber,
        expectedPublicationRevision: publicationRevision,
        idempotencyKey: key(),
      },
      f.couple,
    );
  }
  const registered = (
    input: Parameters<typeof f.services.printable.registerConfirmed>[0] = f.registry,
  ) =>
    f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) =>
      f.services.printable.registerConfirmed(input, ctx),
    );
  const invalidated = (input = f.registry) =>
    f.services.printable.markRequiresReview(
      {
        bookingId: f.bookingId,
        seatingPlanRevisionId: input.seatingPlanRevisionId,
        seatingPlanRevisionNumber: input.seatingPlanRevisionNumber,
        reasonCode: 'LAYOUT_RETIRED',
      },
      { requestId: key(), causationId: key(), actorAccountId: null, authority: 'SYSTEM' },
    );
  const capture = (d: Awaited<ReturnType<typeof design>>) =>
    f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) =>
      f.services.printable.capture({ bookingId: f.bookingId, designRevisionId: d.revisionId }, ctx),
    );
  it('creates immutable design history and durable replay, rejects body reuse and stale CAS', async () => {
    const input = { bookingId: f.bookingId, content: f.content, idempotencyKey: key() };
    const d = await f.services.designs.create(input, f.couple);
    expect(await f.services.designs.create(input, f.couple)).toEqual(d);
    await expect(
      f.services.designs.create(
        { ...input, content: { ...f.content, title: 'Changed' } },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const edited = await f.services.designs.edit(
      {
        bookingId: f.bookingId,
        designId: d.designId,
        expectedRevision: 1,
        textFields: { greeting: 'New' },
        idempotencyKey: key(),
      },
      f.couple,
    );
    expect(edited.revisionNumber).toBe(2);
    expect(await f.prisma.invitationDesignRevision.count({ where: { designId: d.designId } })).toBe(
      2,
    );
    await expect(
      f.services.designs.edit(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          expectedRevision: 1,
          content: f.content,
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.prisma.invitationDesignRevision.update({
        where: { id: d.revisionId },
        data: { content: { title: 'Rewrite' } },
      }),
    ).rejects.toThrow();
    expect((await f.services.designs.list(f.bookingId, { limit: 1 }, f.couple)).items).toHaveLength(
      1,
    );
    expect((await f.services.designs.get(f.bookingId, d.designId, f.couple)).revisionId).toBe(
      edited.revisionId,
    );
  });
  it('has one CAS winner under simultaneous design edits', async () => {
    const d = await design();
    const results = await Promise.allSettled(
      ['A', 'B'].map((greeting) =>
        f.services.designs.edit(
          {
            bookingId: f.bookingId,
            designId: d.designId,
            expectedRevision: 1,
            textFields: { greeting },
            idempotencyKey: key(),
          },
          f.couple,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('enforces authoritative Android text-only editing and denies missing/other ownership', async () => {
    const d = await design();
    await expect(
      f.services.designs.create(
        { bookingId: f.bookingId, content: f.content, idempotencyKey: key() },
        f.android,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.services.designs.edit(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          expectedRevision: 1,
          content: f.content,
          idempotencyKey: key(),
        },
        f.android,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (
        await f.services.designs.edit(
          {
            bookingId: f.bookingId,
            designId: d.designId,
            expectedRevision: 1,
            textFields: { message: 'Mobile' },
            idempotencyKey: key(),
          },
          f.android,
        )
      ).textFields.message,
    ).toBe('Mobile');
    const stranger = await f.actor('COUPLE');
    await expect(f.services.designs.get(f.bookingId, d.designId, stranger)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.services.designs.get(f.bookingId, key(), f.couple)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('Manager templates version/archive/CAS/history; Couple can only select current active templates', async () => {
    const templateId = key();
    const t = await f.services.designs.saveTemplate(
      { templateId, expectedRevision: 0, active: true, content: f.content, idempotencyKey: key() },
      f.manager,
    );
    expect(
      (await f.services.designs.listTemplates({ bookingId: f.bookingId }, f.couple)).items.some(
        (i) => i.templateId === templateId,
      ),
    ).toBe(true);
    expect(
      (
        await f.services.designs.create(
          { bookingId: f.bookingId, templateId, idempotencyKey: key() },
          f.couple,
        )
      ).title,
    ).toBe(f.content.title);
    await f.services.designs.saveTemplate(
      {
        templateId,
        expectedRevision: 1,
        active: false,
        content: { ...f.content, title: 'Archived' },
        idempotencyKey: key(),
      },
      f.manager,
    );
    expect((await f.services.designs.getTemplate(templateId, f.manager, t.versionId)).title).toBe(
      f.content.title,
    );
    await expect(
      f.services.designs.create(
        { bookingId: f.bookingId, templateId, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.services.designs.getTemplate(templateId, f.couple)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.services.designs.listTemplates({ includeArchived: true, bookingId: f.bookingId }, f.couple),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.designs.saveTemplate(
        {
          templateId,
          expectedRevision: 0,
          active: true,
          content: f.content,
          idempotencyKey: key(),
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('AI persists one private output and never calls a paid provider again for the same successful intent', async () => {
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden wedding illustration',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    const result = await f.services.generation.generate(input, f.couple);
    expect(await f.services.generation.generate(input, f.couple)).toEqual(result);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate).toHaveBeenCalledWith({ prompt: input.prompt, aspectRatio: '1:1' });
    expect(await f.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      1,
    );
    const intent = await f.prisma.invitationGenerationIntent.findFirstOrThrow({
      where: { bookingId: f.bookingId },
    });
    expect(intent.status).toBe('ACCEPTED');
    expect(JSON.stringify(intent)).not.toContain(input.prompt);
  });
  it('native runtime uses production Gemini/Storage adapters with controlled SDKs through HTTP', async () => {
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + database.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const generate = vi.fn(() =>
      Promise.resolve({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: f.bytes.toString('base64'), mimeType: 'image/png' } }],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    const adapter = new aiModule.GeminiAiImageProvider({
      model: 'fixture-image',
      client: { models: { generateContent: generate } },
      timeoutMs: 10000,
    });
    const aiFactory = vi.spyOn(aiModule, 'createGeminiAiImageProvider').mockReturnValue(adapter);
    const storageFactory = vi
      .spyOn(storageModule, 'createSupabaseStorageProvider')
      .mockReturnValue(f.storage.provider);
    let runtime: Awaited<ReturnType<typeof createInvitationStudioRuntime>> | undefined;
    try {
      runtime = await createInvitationStudioRuntime({
        ...parseEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: url.toString(),
          PUBLIC_INVITATION_ORIGIN: 'https://wedding.example.test',
        }),
        aiImage: { provider: 'gemini', apiKey: 'controlled-test-key', model: 'fixture-image' },
        storage: {
          enabled: true,
          supabaseUrl: 'https://storage.example.test',
          serviceRoleKey: 'controlled-test-key',
          bucket: 'private-media',
        },
      });
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.requestId = key();
        next();
      });
      app.use('/api/v1', runtime.router);
      app.use(createErrorHandler());
      const input = { prompt: 'A garden wedding', aspectRatio: '1:1' },
        intent = key(),
        path = `/api/v1/bookings/${f.bookingId}/invitation-image-generations`;
      const first = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${f.couple.accessToken}`)
        .set('Idempotency-Key', intent)
        .send(input);
      expect(first.status).toBe(201);
      const retry = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${f.couple.accessToken}`)
        .set('Idempotency-Key', intent)
        .send(input);
      expect(retry.body).toEqual(first.body);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(aiFactory).toHaveBeenCalledWith({
        provider: 'gemini',
        apiKey: 'controlled-test-key',
        model: 'fixture-image',
        timeoutMs: 45000,
      });
      expect(f.storage.bucket.upload).toHaveBeenCalledTimes(1);
    } finally {
      await runtime?.resource.close();
      aiFactory.mockRestore();
      storageFactory.mockRestore();
    }
  });
  it('blocks native opaque credentials from AI and public design text before provider I/O', async () => {
    for (const token of [`wia_${'a'.repeat(43)}`, `wir_${'b'.repeat(43)}`]) {
      await expect(
        f.services.generation.generate(
          {
            bookingId: f.bookingId,
            prompt: `Wedding art ${token}`,
            aspectRatio: '1:1',
            idempotencyKey: key(),
          },
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        f.services.designs.create(
          {
            bookingId: f.bookingId,
            content: { ...f.content, textFields: { message: token } },
            idempotencyKey: key(),
          },
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('reauthorizes archived template lists after a native Manager role is revoked and persists redacted denial', async () => {
    await f.services.designs.saveTemplate(
      {
        templateId: key(),
        expectedRevision: 0,
        active: false,
        content: f.content,
        idempotencyKey: key(),
      },
      f.manager,
    );
    const original = f.services.designs.access.templates.bind(f.services.designs.access);
    const spy = vi
      .spyOn(f.services.designs.access, 'templates')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        await f.prisma.accountRole.deleteMany({
          where: { accountId: f.manager.actorId, role: 'MANAGER' },
        });
      });
    try {
      await expect(
        f.services.designs.listTemplates({ includeArchived: true }, f.manager),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      spy.mockRestore();
    }
    const denial = await f.prisma.auditLog.findFirstOrThrow({
      where: { actorId: f.manager.actorId, action: 'invitation.template-access-denied' },
    });
    expect(denial.metadata).toEqual({});
    expect(JSON.stringify(denial)).not.toContain(f.manager.accessToken);
  });
  it('audits denied Manager template access without retaining resource guesses or credentials', async () => {
    const staff = await f.actor('STAFF');
    await expect(f.services.designs.getTemplate(key(), staff)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await f.prisma.auditLog.count({
        where: { actorId: staff.actorId, action: 'invitation.template-access-denied' },
      }),
    ).toBe(1);
  });
  it.each([false, true])(
    'shared outbox serializers preserve exact frozen print envelopes, explicit causation=%s',
    async (explicit) => {
      const now = new Date().toISOString(),
        printOrderId = key(),
        commercialRevisionId = key(),
        receivableChargeId = key(),
        context = { ...f.manager, ...(explicit ? { causationId: key() } : {}) };
      await f.services.boundary.run(
        { bookingId: f.bookingId, context: { ...f.contract, actorAccountId: f.manager.actorId } },
        async (scope) => {
          const tx = f.services.boundary.requireScope(f.bookingId, scope),
            repository = f.services.studioRepository;
          await repository.printQuotationIssuedEvent(tx, f.bookingId, context, {
            printOrderId,
            commercialRevisionId,
            quotedAt: now,
            expiresAt: now,
          });
          await repository.printOrderApprovedEvent(tx, f.bookingId, context, {
            printOrderId,
            commercialRevisionId,
            receivableChargeId,
            approvedAt: now,
          });
          await repository.printOrderReadyEvent(tx, f.bookingId, context, {
            printOrderId,
            readyAt: now,
          });
        },
      );
      const facts = await f.prisma.invitationStudioOutbox.findMany({
        where: { bookingId: f.bookingId },
      });
      expect(facts.map((row) => row.eventType).sort()).toEqual([
        'invitation.print-order-approved',
        'invitation.print-order-ready',
        'invitation.print-quotation-issued',
      ]);
      for (const fact of facts) {
        expect(fact.envelope).toMatchObject({
          eventVersion: 1,
          producerModule: 'invitation-studio',
          aggregateId: f.bookingId,
          correlationId: f.manager.requestId,
          causationId: context.causationId ?? f.manager.requestId,
          payload: { bookingId: f.bookingId, printOrderId },
        });
        expect(JSON.stringify(fact.envelope)).not.toContain(f.manager.accessToken);
      }
    },
  );
  it('recovers a journaled AI image after acceptance rollback without a second paid generation', async () => {
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    const spy = vi
      .spyOn(f.services.studioRepository, 'audit')
      .mockRejectedValueOnce(new Error('acceptance interrupted'));
    await expect(f.services.generation.generate(input, f.couple)).rejects.toThrow(
      'acceptance interrupted',
    );
    spy.mockRestore();
    expect(await f.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      0,
    );
    const recovered = await f.services.generation.generate(input, f.couple);
    expect(recovered.mediaAssetId).toBeDefined();
    expect(await f.services.generation.generate(input, f.couple)).toEqual(recovered);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(
      (
        await f.prisma.invitationGenerationIntent.findFirstOrThrow({
          where: { bookingId: f.bookingId },
        })
      ).status,
    ).toBe('ACCEPTED');
  });
  it('Manager reconciliation HTTP is scoped, strict, durable and cannot regenerate an abandoned intent', async () => {
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 504,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.requestId = key();
      next();
    });
    app.use('/api/v1', createStudioRouter(f.services, f.services.identity.resolver));
    app.use(createErrorHandler());
    const path = `/api/v1/bookings/${f.bookingId}/invitation-image-generations`;
    expect(
      (await request(app).get(path).set('Authorization', `Bearer ${f.couple.accessToken}`)).status,
    ).toBe(404);
    const pending = await request(app)
      .get(path)
      .set('Authorization', `Bearer ${f.manager.accessToken}`);
    expect(pending.status).toBe(200);
    const pendingData = generationPendingResponse.parse(pending.body).data;
    expect(pendingData.items).toHaveLength(1);
    expect(JSON.stringify(pending.body)).not.toContain('prompt');
    const intentDigest = pendingData.items[0]!.intentDigest,
      command = key(),
      endpoint = `${path}/${intentDigest}/reconciliation`,
      body = { outcome: 'ABANDONED', evidenceReference: 'review-20261009-001' };
    expect(
      (
        await request(app)
          .post(endpoint)
          .set('Authorization', `Bearer ${f.manager.accessToken}`)
          .set('Idempotency-Key', command)
          .send({ ...body, forceRetry: true })
      ).status,
    ).toBe(422);
    const first = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', command)
      .send(body);
    expect(first.status).toBe(200);
    const replay = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', command)
      .send(body);
    expect(replay.body).toEqual(first.body);
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      code: 'AI_GENERATION_ABANDONED',
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(
      await f.prisma.auditLog.count({
        where: { actorId: f.manager.actorId, action: 'invitation.image-generation-abandoned' },
      }),
    ).toBe(1);
  });
  it('a storage acceptance error after successful AI output remains recoverable and does not repeat generation', async () => {
    const original = f.services.service.storage.put.bind(f.services.service.storage);
    const storage = vi
      .spyOn(f.services.service.storage, 'put')
      .mockImplementationOnce(async (command) => {
        await original(command);
        throw new ProviderError('failure');
      });
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 502,
    });
    storage.mockRestore();
    expect(
      (
        await f.prisma.invitationGenerationIntent.findFirstOrThrow({
          where: { bookingId: f.bookingId },
        })
      ).status,
    ).toBe('PENDING');
    expect((await f.services.generation.generate(input, f.couple)).mediaAssetId).toBeDefined();
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('AI unknown timeout survives rollback and retry cannot generate a second output', async () => {
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 504,
    });
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      code: 'AI_GENERATION_PENDING',
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('pending recovery fails closed when the journaled image is absent or server reads are unavailable', async () => {
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    const acceptance = vi
      .spyOn(f.services.studioRepository, 'audit')
      .mockRejectedValueOnce(new Error('interrupted'));
    await expect(f.services.generation.generate(input, f.couple)).rejects.toThrow('interrupted');
    acceptance.mockRestore();
    const read = vi
      .spyOn(f.services.service.storage, 'read')
      .mockRejectedValueOnce(new NotFoundError());
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      code: 'AI_GENERATION_PENDING',
    });
    read.mockRestore();
    const descriptor = Object.getOwnPropertyDescriptor(f.services.service.storage, 'read');
    Object.defineProperty(f.services.service.storage, 'read', {
      value: undefined,
      configurable: true,
    });
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      code: 'AI_GENERATION_PENDING',
    });
    if (descriptor === undefined) delete f.services.service.storage.read;
    else Object.defineProperty(f.services.service.storage, 'read', descriptor);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('pending Manager pages are bounded and stale/missing reconciliation cannot alter intent history', async () => {
    provider.generate.mockRejectedValue(new ProviderError('timeout'));
    for (let i = 0; i < 2; i++)
      await expect(
        f.services.generation.generate(
          { bookingId: f.bookingId, prompt: 'A garden', aspectRatio: '1:1', idempotencyKey: key() },
          f.couple,
        ),
      ).rejects.toMatchObject({ status: 504 });
    const page = await f.services.generation.listPending(f.bookingId, { limit: 1 }, f.manager);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const second = await f.services.generation.listPending(
      f.bookingId,
      { limit: 1, cursor: page.nextCursor },
      f.manager,
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const input = {
      bookingId: f.bookingId,
      intentDigest: page.items[0]!.intentDigest,
      outcome: 'ABANDONED',
      evidenceReference: 'review-002',
      idempotencyKey: key(),
    };
    await expect(
      f.services.generation.reconcile(
        { ...input, intentDigest: 'f'.repeat(64), idempotencyKey: key() },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.generation.reconcile(
        { ...input, evidenceReference: `wia_${'a'.repeat(43)}` },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
    await f.services.generation.reconcile(input, f.manager);
    await expect(
      f.services.generation.reconcile({ ...input, idempotencyKey: key() }, f.manager),
    ).rejects.toMatchObject({ code: 'AI_GENERATION_RECONCILIATION_STALE' });
    expect(
      (await f.services.generation.listPending(f.bookingId, {}, f.manager)).items,
    ).toHaveLength(1);
  });
  it('AI rejects sensitive prompts and untrusted mismatching pixels without persisting media', async () => {
    await expect(
      f.services.generation.generate(
        {
          bookingId: f.bookingId,
          prompt: 'Send to private@example.test',
          aspectRatio: '1:1',
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(provider.generate).not.toHaveBeenCalled();
    provider.generate.mockResolvedValueOnce({
      ...createGeneratedAiImage(f.bytes, 'image/png'),
      width: 999,
    });
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 502,
    });
    await expect(f.services.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 502,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await f.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      0,
    );
  });
  it('private originals become separately derived assets; unpublished assets remain concealed; ownership is exact', async () => {
    const media = await f.services.service.upload(
      {
        bookingId: f.bookingId,
        bytes: f.bytes,
        contentType: 'image/png',
        altText: 'Private',
        idempotencyKey: key(),
      },
      f.couple,
    );
    const derived = await f.services.derivedAssets.derive(
      {
        bookingId: f.bookingId,
        mediaAssetId: media.id,
        expectedRevision: 1,
        idempotencyKey: key(),
      },
      f.couple,
    );
    const asset = await f.prisma.invitationDerivedAsset.findUniqueOrThrow({
      where: { id: derived.derivedAssetId },
    });
    await expect(f.services.derivedAssets.readPublic(asset.publicSlug)).rejects.toMatchObject({
      status: 404,
    });
    const d = await f.services.designs.create(
      {
        bookingId: f.bookingId,
        content: {
          ...f.content,
          derivedAssetIds: [asset.id],
          sections: [{ kind: 'HERO', textKey: 'greeting', derivedAssetId: asset.id }],
        },
        idempotencyKey: key(),
      },
      f.couple,
    );
    const p = await publish(d);
    const dto = await f.services.publication.readPublic(p.publicSlug);
    const serialized = JSON.stringify(dto);
    for (const privateValue of [
      f.bookingId,
      media.id,
      asset.sourceFileId,
      'objectKey',
      'signedUrl',
      'guestGroup',
      'accessToken',
    ])
      expect(serialized).not.toContain(privateValue);
    expect(await f.services.derivedAssets.readPublic(asset.publicSlug)).toBeInstanceOf(Uint8Array);
    await f.services.publication.unpublish(
      { bookingId: f.bookingId, designId: d.designId, expectedRevision: 1, idempotencyKey: key() },
      f.manager,
    );
    await expect(f.services.publication.readPublic(p.publicSlug)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.services.derivedAssets.readPublic(asset.publicSlug)).rejects.toMatchObject({
      status: 404,
    });
    expect(f.storage.bucket.remove).not.toHaveBeenCalled();
    await expect(
      f.services.designs.create(
        {
          bookingId: f.bookingId,
          content: { ...f.content, derivedAssetIds: [key()] },
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('publication stable identity spans variants, CAS/outbox atomicity, removed fact keeps frozen event meaning', async () => {
    const first = await design(),
      p1 = await publish(first),
      second = await design(),
      p2 = await publish(second, 1);
    expect(p2.publicSlug).toBe(p1.publicSlug);
    expect(p2.genericQrPayload).toBe(p1.genericQrPayload);
    await expect(publish(first, 1)).rejects.toMatchObject({ status: 409 });
    expect(await f.services.publication.requirePublishedPublicInvitation(f.bookingId)).toEqual({
      publicInvitationId: p2.publicInvitationId,
      publicSlug: p2.publicSlug,
      publishedRevisionId: p2.publishedRevisionId,
    });
    const input = {
      bookingId: f.bookingId,
      designId: second.designId,
      expectedRevision: 2,
      idempotencyKey: key(),
    };
    await f.services.publication.unpublish(input, f.couple);
    await f.services.publication.unpublish(input, f.couple);
    const events = await f.prisma.invitationStudioOutbox.findMany({
      where: { bookingId: f.bookingId },
    });
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'invitation.publication-changed',
      'invitation.publication-changed',
      'invitation.unpublished',
    ]);
    expect(JSON.stringify(events)).not.toContain('published":false');
    expect(
      await f.prisma.invitationPublishedRevision.count({ where: { bookingId: f.bookingId } }),
    ).toBe(2);
    await expect(f.services.publication.readPublic('bad')).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.publication.requirePublishedPublicInvitation(f.bookingId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each(['CONFIRM_FIRST', 'INVALIDATE_FIRST'])(
    'registry equal-number invalidation wins in %s order, replay/higher reconfirm/delayed lower are safe',
    async (order) => {
      if (order === 'CONFIRM_FIRST') await registered();
      await invalidated();
      await registered();
      expect(await registered()).toEqual({ registered: true, replayed: true });
      expect(await invalidated()).toEqual({ invalidated: true, replayed: true });
      expect(
        (
          await f.prisma.invitationSeatingState.findUniqueOrThrow({
            where: { bookingId: f.bookingId },
          })
        ).status,
      ).toBe('REQUIRES_REVIEW');
      const higher = { ...f.registry, seatingPlanRevisionId: key(), seatingPlanRevisionNumber: 3 };
      await registered(higher);
      await invalidated({
        ...f.registry,
        seatingPlanRevisionId: key(),
        seatingPlanRevisionNumber: 2,
      });
      expect(
        (
          await f.prisma.invitationSeatingState.findUniqueOrThrow({
            where: { bookingId: f.bookingId },
          })
        ).revisionNumber,
      ).toBe(3);
      await expect(registered({ ...higher, contentDigest: 'a'.repeat(64) })).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        f.prisma.invitationSeatingState.update({
          where: { bookingId: f.bookingId },
          data: { revisionNumber: 1 },
        }),
      ).rejects.toThrow();
    },
  );
  it('registry requires live proof, exact immutable geometry/digest; owner work rolls back on rejection', async () => {
    const { validityProof: _proof, ...legacy } = f.registry;
    expect(_proof.bookingRevision).toBe(1);
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) =>
        f.services.printable.registerConfirmed(legacy, ctx),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const renderSnapshot = f.registry.renderSnapshot.map((t) => ({ ...t, x: 3 }));
    await expect(
      registered({ ...f.registry, renderSnapshot, contentDigest: digest(renderSnapshot) }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
        const tx = f.services.boundary.requireScope(f.bookingId, ctx);
        await tx.booking.update({
          where: { id: f.bookingId },
          data: { planningHeadcount: 21, revision: 2 },
        });
        await f.services.printable.registerConfirmed(f.registry, ctx);
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await f.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).planningHeadcount,
    ).toBe(20);
  });
  it('captures immutable generic-QR printable with explicit null seating and exact reader fields', async () => {
    const d = await design(),
      p = await publish(d),
      printed = await capture(d);
    expect(printed.content.seating).toBeNull();
    expect(printed.content.genericQrPayload).toBe(p.genericQrPayload);
    expect(
      await f.services.publication.resolvePrintableRevision(printed.printableRevisionId),
    ).toEqual({
      bookingId: f.bookingId,
      designRevisionId: d.revisionId,
      timelineRevisionId: f.timelineId,
      seatingPlanRevisionId: null,
      publicInvitationId: p.publicInvitationId,
      contentDigest: printed.contentDigest,
    });
    await f.services.publication.unpublish(
      { bookingId: f.bookingId, expectedRevision: 1, idempotencyKey: key() },
      f.couple,
    );
    expect(
      (await f.services.publication.resolvePrintableRevision(printed.printableRevisionId))
        .contentDigest,
    ).toBe(printed.contentDigest);
    await expect(
      f.prisma.invitationPrintableRevision.delete({ where: { id: printed.printableRevisionId } }),
    ).rejects.toThrow();
  });
  it('print rejects zero/out-of-range pending invalidation, but accepts current in-range headcount after reconfirmed source', async () => {
    const d = await design(true);
    await publish(d);
    await registered();
    await f.prisma.booking.update({
      where: { id: f.bookingId },
      data: { planningHeadcount: 25, revision: 2 },
    });
    await expect(capture(d)).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
    const current = await f.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const reconfirmed = {
      ...f.registry,
      seatingPlanRevisionId: key(),
      seatingPlanRevisionNumber: 2,
      validityProof: {
        ...f.registry.validityProof,
        bookingRevision: current.revision,
        expectedAttendees: 25,
      },
    };
    await registered(reconfirmed);
    expect((await capture(d)).content.seating?.seatingPlanRevisionId).toBe(
      reconfirmed.seatingPlanRevisionId,
    );
    for (const headcount of [31, 0, 41]) {
      await f.prisma.booking.update({
        where: { id: f.bookingId },
        data: { planningHeadcount: headcount, revision: { increment: 1 } },
      });
      await expect(capture(d)).rejects.toMatchObject({ status: 409 });
    }
  });
  it('retired layout is read historically but cannot enter a new printable', async () => {
    const d = await design(true);
    await publish(d);
    await registered();
    await f.layout.changeLifecycle({
      aggregateId: f.templateId,
      expectedRevision: 2,
      transition: 'RETIRE',
      context: f.ownerContext,
    });
    expect((await f.layout.resolveVersion(f.layoutId)).tables).toHaveLength(1);
    await expect(capture(d)).rejects.toMatchObject({ status: 409 });
  });
  it('trusted scope validation blocks HTTP-style SYSTEM forgery and cross-book enlistment', async () => {
    await expect(
      f.services.printable.registerConfirmed(f.registry, f.contract),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      f.services.boundary.run(
        {
          bookingId: f.bookingId,
          context: { ...f.contract, authority: 'SYSTEM', actorAccountId: null },
        },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) => {
      expect(() => f.services.boundary.requireScope(key(), ctx)).toThrow();
      expect(() =>
        f.services.boundary.enlist({ ...ctx, actorAccountId: f.manager.actorId }),
      ).toThrow();
      return Promise.resolve();
    });
  });
  it('HTTP strict bodies/queries/auth, publication JSON/render/generic PNG and no-store are executable', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.requestId = key();
      next();
    });
    app.use('/api/v1', createStudioRouter(f.services, f.services.identity.resolver));
    app.use(createErrorHandler());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${f.couple.accessToken}`);
    const base = `/api/v1/bookings/${f.bookingId}/invitations`;
    expect((await request(app).get(base)).status).toBe(401);
    expect((await auth(request(app).get(base + '?limit=101'))).status).toBe(422);
    expect(
      (
        await auth(request(app).post(base))
          .set('Idempotency-Key', key())
          .send({ content: f.content, clientKind: 'WEB' })
      ).status,
    ).toBe(422);
    const result = await auth(request(app).post(base))
      .set('Idempotency-Key', key())
      .send({ content: f.content });
    expect(result.status).toBe(201);
    const d = designResponse.parse(result.body).data;
    const response = await auth(request(app).post(base + `/${d.designId}/publication`))
      .set('Idempotency-Key', key())
      .send({
        expectedRevision: 1,
        designRevisionId: d.revisionId,
        expectedPublicationRevision: 0,
      });
    expect(response.status).toBe(200);
    const slug = publicationResponse.parse(response.body).data.publicSlug;
    const pub = await request(app).get('/api/v1/public/invitations/' + slug);
    expect(pub.status).toBe(200);
    expect(pub.headers['cache-control']).toBe('no-store');
    expect((await request(app).get(`/api/v1/public/invitations/${slug}/render`)).type).toBe(
      'text/html',
    );
    expect((await request(app).get(`/api/v1/public/invitations/${slug}/qr`)).type).toBe(
      'image/png',
    );
    expect(
      (await request(app).get(`/api/v1/public/invitations/${slug}?token=private`)).status,
    ).toBe(422);
  });
  it('publication and outbox rollback together under enlisted owner failure', async () => {
    const d = await design();
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
        await f.services.publication.publish(
          {
            bookingId: f.bookingId,
            designId: d.designId,
            designRevisionId: d.revisionId,
            expectedRevision: 1,
            expectedPublicationRevision: 0,
            idempotencyKey: key(),
          },
          { ...f.couple, transactionScopeId: ctx.transactionScopeId! },
        );
        throw new Error('owner failure');
      }),
    ).rejects.toThrow('owner failure');
    expect(
      await f.prisma.invitationPublicIdentity.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
    expect(await f.prisma.invitationStudioOutbox.count({ where: { bookingId: f.bookingId } })).toBe(
      0,
    );
  });
  it('disabled AI/origin fail closed; refusal is durable; cutoff and quota prevent provider calls', async () => {
    const disabled = createInvitationStudioServices(
      f.prisma,
      f.storage.provider,
      null,
      null,
      () => f.now,
    );
    const input = {
      bookingId: f.bookingId,
      prompt: 'A garden',
      aspectRatio: '1:1',
      idempotencyKey: key(),
    };
    await expect(disabled.generation.generate(input, f.couple)).rejects.toMatchObject({
      status: 503,
    });
    const d = await design();
    await expect(
      disabled.publication.publish(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          designRevisionId: d.revisionId,
          expectedRevision: 1,
          expectedPublicationRevision: 0,
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 503 });
    provider.generate.mockRejectedValueOnce(new AiImageSafetyRefusalError());
    const refused = { ...input, idempotencyKey: key() };
    await expect(f.services.generation.generate(refused, f.couple)).rejects.toMatchObject({
      status: 422,
    });
    await expect(f.services.generation.generate(refused, f.couple)).rejects.toMatchObject({
      status: 422,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    await f.services.service.changeCutoff(
      {
        bookingId: f.bookingId,
        expectedRevision: 0,
        cutoffAt: f.now.toISOString(),
        idempotencyKey: key(),
      },
      f.manager,
    );
    await expect(
      f.services.generation.generate({ ...input, idempotencyKey: key() }, f.couple),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('AI quota is checked before calling provider', async () => {
    await f.prisma.$transaction(async (tx) => {
      for (let i = 0; i < 100; i++) await insertDatabaseMedia(tx, f.bookingId, 8);
    });
    await expect(
      f.services.generation.generate(
        { bookingId: f.bookingId, prompt: 'A garden', aspectRatio: '1:1', idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('HTTP executes template lifecycle, private lists/revisions, generation, derived asset and unpublication', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.requestId = key();
      next();
    });
    app.use('/api/v1', createStudioRouter(f.services, f.services.identity.resolver));
    app.use(createErrorHandler());
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, manager = false) =>
      request(app)
        [method]('/api/v1' + path)
        .set('Authorization', `Bearer ${manager ? f.manager.accessToken : f.couple.accessToken}`);
    const templateKey = key(),
      templateBody = { expectedRevision: 0, active: true, content: f.content };
    const created = await call('post', '/management/invitation-templates', true)
      .set('Idempotency-Key', templateKey)
      .send(templateBody);
    expect(created.status).toBe(201);
    expect(
      (
        await call('post', '/management/invitation-templates', true)
          .set('Idempotency-Key', templateKey)
          .send(templateBody)
      ).body,
    ).toEqual(created.body);
    const t = (
      await import('../../../src/modules/invitation-studio/http/studio.schemas.js')
    ).templateResponse.parse(created.body).data;
    expect(
      (
        await call(
          'get',
          `/management/invitation-templates/${t.templateId}?versionId=${t.versionId}`,
          true,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call('patch', `/management/invitation-templates/${t.templateId}`, true)
          .set('Idempotency-Key', key())
          .send({ ...templateBody, expectedRevision: 1, active: false })
      ).status,
    ).toBe(200);
    expect(
      (await call('get', '/management/invitation-templates?includeArchived=true&limit=1', true))
        .status,
    ).toBe(200);
    expect((await call('get', `/invitation-templates?bookingId=${f.bookingId}`)).status).toBe(200);
    const base = `/bookings/${f.bookingId}/invitations`,
      d = await design();
    expect((await call('get', base)).status).toBe(200);
    expect((await call('get', `${base}/${d.designId}`)).status).toBe(200);
    expect(
      (
        await call('post', `${base}/${d.designId}/revisions`)
          .set('Idempotency-Key', key())
          .send({ expectedRevision: 1, textFields: { message: 'Revised' } })
      ).status,
    ).toBe(201);
    expect((await call('post', base).send({ content: f.content })).status).toBe(400);
    expect(
      (
        await request(app)
          .get('/api/v1' + base)
          .set('Authorization', 'Bearer wrong')
      ).status,
    ).toBe(401);
    const generated = await call('post', `/bookings/${f.bookingId}/invitation-image-generations`)
      .set('Idempotency-Key', key())
      .send({ prompt: 'A garden', aspectRatio: '1:1' });
    expect(generated.status).toBe(201);
    const media = (
      await import('../../../src/modules/invitation-studio/http/media.schemas.js')
    ).mediaAssetResponseSchema.parse(generated.body).data;
    const derived = await call('post', `/bookings/${f.bookingId}/invitation-derived-assets`)
      .set('Idempotency-Key', key())
      .send({ mediaAssetId: media.mediaAssetId, expectedRevision: 1 });
    expect(derived.status).toBe(201);
    const a = (
      await import('../../../src/modules/invitation-studio/http/studio.schemas.js')
    ).derivedResponse.parse(derived.body).data;
    const designWithAsset = await f.services.designs.create(
      {
        bookingId: f.bookingId,
        content: {
          ...f.content,
          derivedAssetIds: [a.derivedAssetId],
          sections: [{ kind: 'HERO', textKey: null, derivedAssetId: a.derivedAssetId }],
        },
        idempotencyKey: key(),
      },
      f.couple,
    );
    const pub = await publish(designWithAsset);
    const asset = await f.prisma.invitationDerivedAsset.findUniqueOrThrow({
      where: { id: a.derivedAssetId },
    });
    expect(
      (await request(app).get('/api/v1/public/invitation-assets/' + asset.publicSlug)).type,
    ).toBe('image/png');
    expect(
      (
        await call('delete', `${base}/${designWithAsset.designId}/publication`)
          .set('Idempotency-Key', key())
          .send({ expectedRevision: pub.publicationRevision })
      ).status,
    ).toBe(200);
  });
  it('equal registration/invalidation in one transaction checks the final high-water head', async () => {
    await f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
      await f.services.printable.registerConfirmed(f.registry, ctx);
      await f.services.printable.markRequiresReview(
        {
          bookingId: f.bookingId,
          seatingPlanRevisionId: f.registry.seatingPlanRevisionId,
          seatingPlanRevisionNumber: 1,
          reasonCode: 'LAYOUT_RETIRED',
        },
        ctx,
      );
    });
    expect(
      (
        await f.prisma.invitationSeatingState.findUniqueOrThrow({
          where: { bookingId: f.bookingId },
        })
      ).status,
    ).toBe('REQUIRES_REVIEW');
  });
  it('Identity editor denies missing bearer, actor mismatch, unavailable session and disabled trusted account', async () => {
    const access = f.services.designs.access;
    await expect(
      access.actor({ actorId: f.couple.actorId, requestId: key() }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(access.actor({ ...f.couple, actorId: f.manager.actorId })).rejects.toMatchObject({
      status: 401,
    });
    await expect(access.booking(f.bookingId, f.manager, 'COUPLE')).rejects.toMatchObject({
      status: 404,
    });
    const actor = await f.services.identity.resolver.resolve(f.couple.accessToken);
    const inconsistent = createInvitationEditorReader(f.prisma, f.services.boundary, {
      resolve: () => Promise.resolve({ ...actor, sessionId: key() }),
    });
    await expect(inconsistent.resolve(f.couple.accessToken)).rejects.toMatchObject({ status: 401 });
    await f.prisma.account.update({
      where: { id: f.couple.actorId },
      data: { status: 'DISABLED', disabledAt: f.now },
    });
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (ctx) =>
        f.services.editor.resolveContext(ctx),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      f.services.editor.resolveContext({ ...f.contract, actorAccountId: null }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('native Venue eligibility conceals absent/draft versions, retains active superseded layout eligibility', async () => {
    const draft = key();
    await f.layout.cloneVersion({
      templateId: f.templateId,
      sourceVersionId: f.layoutId,
      versionId: draft,
      context: f.ownerContext,
    });
    await f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
      await expect(f.services.venue.getLayoutEligibility(key(), ctx)).rejects.toMatchObject({
        status: 404,
      });
      await expect(f.services.venue.getLayoutEligibility(draft, ctx)).rejects.toMatchObject({
        status: 404,
      });
    });
    const d = await design(true);
    await publish(d);
    await registered();
    await f.layout.publish({
      templateId: f.templateId,
      versionId: draft,
      expectedRevision: 1,
      context: f.ownerContext,
    });
    await f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
      expect(
        (await f.services.venue.getLayoutEligibility(f.layoutId, ctx)).currentForNewSelection,
      ).toBe(false);
      expect(
        (
          await f.services.printable.capture(
            { bookingId: f.bookingId, designRevisionId: d.revisionId },
            ctx,
          )
        ).content.seating,
      ).not.toBeNull();
    });
  });
  it('template/design pagination preserves cursors and rejects wrong-role/history/resource reads', async () => {
    await design();
    await design();
    const first = await f.services.designs.list(f.bookingId, { limit: 1 }, f.couple);
    expect(first.nextCursor).not.toBeNull();
    expect(
      (await f.services.designs.list(f.bookingId, { limit: 1, cursor: first.nextCursor }, f.couple))
        .items,
    ).toHaveLength(1);
    const staff = await f.actor('STAFF');
    await expect(f.services.designs.listTemplates({}, staff)).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.services.designs.getTemplate(key(), f.manager)).rejects.toMatchObject({
      status: 404,
    });
    const t = await f.services.designs.saveTemplate(
      {
        templateId: key(),
        expectedRevision: 0,
        active: true,
        content: f.content,
        idempotencyKey: key(),
      },
      f.manager,
    );
    await expect(
      f.services.designs.getTemplate(t.templateId, f.manager, key()),
    ).rejects.toMatchObject({ status: 404 });
    expect((await f.services.designs.getTemplate(t.templateId, f.manager)).versionId).toBe(
      t.versionId,
    );
    await expect(
      f.services.designs.saveTemplate(
        {
          templateId: key(),
          expectedRevision: 0,
          active: true,
          content: { ...f.content, derivedAssetIds: [key()] },
          idempotencyKey: key(),
        },
        f.manager,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const page = await f.services.designs.listTemplates(
      { includeArchived: true, limit: 1 },
      f.manager,
    );
    expect(page.nextCursor).not.toBeNull();
    expect(
      (
        await f.services.designs.listTemplates(
          { includeArchived: true, limit: 1, cursor: page.nextCursor },
          f.manager,
        )
      ).items,
    ).toHaveLength(1);
    await expect(
      f.services.designs.edit(
        {
          bookingId: f.bookingId,
          designId: key(),
          expectedRevision: 1,
          textFields: { message: 'Hello' },
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('publication rejects stale exact design, wrong unpublish variant/revision and absent histories', async () => {
    const d = await design();
    await expect(
      f.services.publication.unpublish(
        { bookingId: f.bookingId, expectedRevision: 1, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.publication.publish(
        {
          bookingId: f.bookingId,
          designId: key(),
          designRevisionId: d.revisionId,
          expectedRevision: 1,
          expectedPublicationRevision: 0,
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.publication.publish(
        {
          bookingId: f.bookingId,
          designId: d.designId,
          designRevisionId: key(),
          expectedRevision: 1,
          expectedPublicationRevision: 0,
          idempotencyKey: key(),
        },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await publish(d);
    await expect(
      f.services.publication.unpublish(
        { bookingId: f.bookingId, designId: key(), expectedRevision: 1, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.services.publication.unpublish(
        { bookingId: f.bookingId, expectedRevision: 2, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await f.services.publication.unpublish(
      { bookingId: f.bookingId, expectedRevision: 1, idempotencyKey: key() },
      f.couple,
    );
    await expect(
      f.services.publication.unpublish(
        { bookingId: f.bookingId, expectedRevision: 2, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.services.publication.resolvePrintableRevision(key())).rejects.toMatchObject({
      status: 404,
    });
  });
  it('derived intent survives owner rollback, safely retries the exact object and rejects stale/unavailable reads', async () => {
    const media = await f.services.service.upload(
      {
        bookingId: f.bookingId,
        bytes: f.bytes,
        contentType: 'image/png',
        altText: 'Private',
        idempotencyKey: key(),
      },
      f.couple,
    );
    const input = {
      bookingId: f.bookingId,
      mediaAssetId: media.id,
      expectedRevision: 1,
      idempotencyKey: key(),
    };
    await expect(
      f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async (ctx) => {
        await f.services.derivedAssets.derive(input, {
          ...f.couple,
          transactionScopeId: ctx.transactionScopeId!,
        });
        throw new Error('owner rollback');
      }),
    ).rejects.toThrow('owner rollback');
    expect(await f.prisma.invitationDerivedAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      0,
    );
    const result = await f.services.derivedAssets.derive(input, f.couple);
    expect(await f.services.derivedAssets.derive(input, f.couple)).toEqual(result);
    await expect(
      f.services.derivedAssets.derive(
        { ...input, expectedRevision: 2, idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.services.derivedAssets.derive(
        { ...input, mediaAssetId: key(), idempotencyKey: key() },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.services.derivedAssets.readPublic('bad')).rejects.toMatchObject({ status: 404 });
    await expect(f.services.derivedAssets.readPublic('a'.repeat(64))).rejects.toMatchObject({
      status: 404,
    });
    const storage = {
      put: f.storage.provider.put.bind(f.storage.provider),
      createSignedReadUrl: f.storage.provider.createSignedReadUrl.bind(f.storage.provider),
      delete: f.storage.provider.delete.bind(f.storage.provider),
    };
    const unavailable = createInvitationStudioServices(f.prisma, storage, null, null, () => f.now);
    await expect(
      unavailable.derivedAssets.derive({ ...input, idempotencyKey: key() }, f.couple),
    ).rejects.toMatchObject({ status: 503 });
    await expect(unavailable.derivedAssets.readPublic('a'.repeat(64))).rejects.toMatchObject({
      status: 503,
    });
    const asset = await f.prisma.invitationDerivedAsset.findUniqueOrThrow({
      where: { id: result.derivedAssetId },
    });
    await publish(await design());
    await expect(f.services.derivedAssets.readPublic(asset.publicSlug)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('Manager exception allows range override within physical capacity and rejects stale revision/count', async () => {
    await f.prisma.booking.update({
      where: { id: f.bookingId },
      data: { planningHeadcount: 35, revision: 2 },
    });
    const proof = {
      ...f.registry.validityProof,
      bookingRevision: 2,
      expectedAttendees: 35,
      managerException: { approvalId: key(), approvedBookingRevision: 2, approvedHeadcount: 35 },
    };
    const input = { ...f.registry, validityProof: proof };
    await registered(input);
    const d = await design(true);
    await publish(d);
    expect((await capture(d)).content.seating).not.toBeNull();
    await f.prisma.booking.update({ where: { id: f.bookingId }, data: { revision: 3 } });
    await expect(capture(d)).rejects.toMatchObject({ status: 409 });
    await expect(
      registered({
        ...input,
        seatingPlanRevisionId: key(),
        seatingPlanRevisionNumber: 2,
        validityProof: { ...proof, bookingRevision: 3 },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('historical null-proof snapshot and stale design cannot authorize a new print', async () => {
    const d = await design(true);
    await publish(d);
    await f.prisma.invitationSeatingRevision.create({
      data: {
        id: f.registry.seatingPlanRevisionId,
        bookingId: f.bookingId,
        revisionNumber: 1,
        layoutTemplateVersionId: f.layoutId,
        contentDigest: f.registry.contentDigest,
        renderSnapshot: f.registry.renderSnapshot,
      },
    });
    await f.prisma.invitationSeatingState.create({
      data: {
        bookingId: f.bookingId,
        revisionNumber: 1,
        revisionId: f.registry.seatingPlanRevisionId,
        status: 'ELIGIBLE',
      },
    });
    await expect(capture(d)).rejects.toMatchObject({ status: 409 });
    await f.services.designs.edit(
      {
        bookingId: f.bookingId,
        designId: d.designId,
        expectedRevision: 1,
        textFields: { message: 'New' },
        idempotencyKey: key(),
      },
      f.couple,
    );
    await expect(capture(d)).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });
  });
  it('Venue retirement waits for registry/print shared lifecycle locks through owner commit', async () => {
    const d = await design(true);
    await publish(d);
    await registered();
    let release!: () => void, held!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const captured = f.services.boundary.run(
      { bookingId: f.bookingId, context: f.contract },
      async (ctx) => {
        const snapshot = await f.services.printable.capture(
          { bookingId: f.bookingId, designRevisionId: d.revisionId },
          ctx,
        );
        held();
        await gate;
        return snapshot;
      },
    );
    await ready;
    let settled = false;
    const retirement = f.layout
      .changeLifecycle({
        aggregateId: f.templateId,
        expectedRevision: 2,
        transition: 'RETIRE',
        context: f.ownerContext,
      })
      .finally(() => {
        settled = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    const snapshot = await captured;
    await retirement;
    expect(
      (await f.services.publication.resolvePrintableRevision(snapshot.printableRevisionId))
        .contentDigest,
    ).toBe(snapshot.contentDigest);
    await expect(capture(d)).rejects.toMatchObject({ status: 409 });
  });
  it('timeline activation/headcount writer waits for print capture; old snapshot stays unchanged', async () => {
    const d = await design(true);
    await publish(d);
    await registered();
    const nextTimelineId = key();
    await nativeTimelineFixture(f.prisma, {
      bookingId: f.bookingId,
      timelineId: nextTimelineId,
      revisionNumber: 2,
      actorId: f.manager.actorId,
      now: f.now,
      startTime: '11:10',
      title: 'Revised welcome',
      predecessorRevisionId: f.timelineId,
    });
    let release!: () => void, held!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const capturing = f.services.boundary.run(
      { bookingId: f.bookingId, context: f.contract },
      async (ctx) => {
        const result = await f.services.printable.capture(
          { bookingId: f.bookingId, designRevisionId: d.revisionId },
          ctx,
        );
        held();
        await gate;
        return result;
      },
    );
    await ready;
    let changed = false;
    const writer = f.prisma.booking
      .update({
        where: { id: f.bookingId },
        data: {
          effectiveTimelineRevisionId: nextTimelineId,
          planningHeadcount: 31,
          revision: { increment: 1 },
        },
      })
      .then((result) => {
        changed = true;
        return result;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(changed).toBe(false);
    } finally {
      release();
    }
    const printed = await capturing;
    await writer;
    const read = await f.services.publication.resolvePrintableRevision(printed.printableRevisionId);
    expect(read.timelineRevisionId).toBe(f.timelineId);
    expect(read.contentDigest).toBe(printed.contentDigest);
    await expect(capture(d)).rejects.toMatchObject({ status: 409 });
    await f.prisma.booking.update({
      where: { id: f.bookingId },
      data: { planningHeadcount: 25, revision: { increment: 1 } },
    });
    await expect(capture(d)).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
    const current = await f.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const reconfirmed = {
      ...f.registry,
      seatingPlanRevisionId: key(),
      seatingPlanRevisionNumber: 2,
      validityProof: {
        ...f.registry.validityProof,
        bookingRevision: current.revision,
        expectedAttendees: 25,
      },
    };
    await registered(reconfirmed);
    expect((await capture(d)).content.timeline.timelineRevisionId).toBe(nextTimelineId);
  });
});
