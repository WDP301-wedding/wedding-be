import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { seedVenueCatalog } from '../../scripts/catalog-seed.js';
import { createPrintOfferingService } from '../../src/modules/venue-catalog/application/print-offering.service.js';
import { createPrintCommercialCatalogRouter } from '../../src/modules/venue-catalog/http/commercial-catalog.router.js';
import { printOfferingViewSchema } from '../../src/modules/venue-catalog/domain/commercial-offering.js';
import { createInvitationTemplateSelectionReader } from '../../src/modules/invitation-studio/infrastructure/template-selection.reader.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('selectable print catalog pages with database latency', () => {
  it.each(['shared', 'distinct'] as const)(
    'returns 50 offerings with %s templates and 40ms query latency',
    async (kind) => {
      const database = new CatalogTestDatabase('print_page');
      try {
        await database.connect();
        await seedVenueCatalog(database.prisma);
        const templates = await database.prisma.$transaction(async (tx) => {
          const sources = [];
          for (let n = 0; n < (kind === 'shared' ? 1 : 50); n++) {
            const templateId = randomUUID(),
              templateVersionId = randomUUID();
            await tx.invitationTemplateVersion.create({
              data: {
                id: templateVersionId,
                templateId,
                revision: 1,
                content: { title: `Template ${n}`, textFields: { message: 'Private body' } },
              },
            });
            await tx.invitationTemplate.create({
              data: {
                id: templateId,
                currentVersionId: templateVersionId,
                revision: 1,
                active: true,
              },
            });
            sources.push({ templateId, templateVersionId });
          }
          return sources;
        });
        const service = createPrintOfferingService(
          database.prisma,
          createInvitationTemplateSelectionReader,
        );
        const expectedIds = [];
        for (let n = 0; n < 50; n++) {
          const row = await service.create(
            {
              ...templates[kind === 'shared' ? 0 : n],
              name: `Offering ${n}`,
              printType: 'Two-sided',
              material: 'Paper',
              unitPriceVnd: 5000,
              active: true,
            },
            { actorId: randomUUID(), requestId: randomUUID() },
          );
          expectedIds.push(row.offeringId);
        }
        // Intercept all database operations, so the latency model survives reader refactors.
        const delayed = database.prisma.$extends({
          query: {
            $allOperations: async ({ args, query }) => {
              await delay(40);
              const result: unknown = await query(args);
              return result;
            },
          },
        }) as typeof database.prisma;
        const actor = {
          accountId: randomUUID(),
          sessionId: randomUUID(),
          displayEmail: 'probe@example.com',
          roles: [],
        };
        const app = createApp({
          runtimeEnvironment: 'test',
          registerRoutes(express) {
            express.use(
              '/api/v1',
              createPrintCommercialCatalogRouter(
                createPrintOfferingService(delayed, createInvitationTemplateSelectionReader),
                { resolve: () => Promise.resolve(actor) },
                () => (_request, _response, next) => next(),
              ),
            );
          },
        });
        const response = await request(app)
          .get('/api/v1/catalog/print-offerings?limit=50')
          .set('Authorization', 'Bearer probe');
        expect(response.status).toBe(200);
        const result = z
          .strictObject({
            data: z.strictObject({
              items: z.array(printOfferingViewSchema),
              nextCursor: z.uuid().nullable(),
            }),
          })
          .parse(response.body as unknown);
        expect(result.data.items.map((row) => row.offeringId).sort()).toEqual(expectedIds.sort());
        expect(result.data.nextCursor).toBeNull();
        expect(JSON.stringify(response.body)).not.toMatch(/Private body|textFields|content/);
      } finally {
        await database.disconnect();
      }
    },
    30000,
  );
});
