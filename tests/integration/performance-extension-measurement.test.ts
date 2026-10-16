import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  DiagnosticPool,
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { createCatalogQueryService } from '../../src/modules/venue-catalog/application/catalog-query.service.js';
import { createCatalogMediaService } from '../../src/modules/venue-catalog/application/catalog-media.service.js';
import { createVenueService } from '../../src/modules/venue-catalog/application/venue.service.js';
import { FakeStorageProvider } from '../../src/integrations/storage/fake-storage-provider.js';
import { createAnalyticsServices } from '../../src/modules/analytics-dashboard/infrastructure/analytics.composition.js';
import type { DesignService as DesignServiceClass } from '../../src/modules/invitation-studio/infrastructure/design.service.js';
import type { PrintOrderService as PrintOrderServiceClass } from '../../src/modules/invitation-studio/infrastructure/print-order.service.js';
import type { AnalyticsProjector as AnalyticsProjectorClass } from '../../src/modules/analytics-dashboard/application/projection.js';
import type { AnalyticsService as AnalyticsServiceClass } from '../../src/modules/analytics-dashboard/application/analytics.service.js';
import type { createProjectionRepository as createProjectionRepositoryClass } from '../../src/modules/analytics-dashboard/infrastructure/projection.repository.js';
import type { StudioAuthorization as StudioAuthorizationClass } from '../../src/modules/invitation-studio/infrastructure/studio-authorization.js';
import type { createInvitationEditorReader as EditorReaderFactory } from '../../src/modules/identity-access/authorization/invitation-editor.reader.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

const baseline = process.env.PERF_COMPARE_BASELINE;
const sampleCount = Number(process.env.PERF_SAMPLES ?? 2);
const poolMax = Number(process.env.PERF_POOL_MAX ?? 3);
const readers = Number(process.env.PERF_READERS ?? 1);
const addedDelay = baseline ? 40 : 0;
// The model delays each real driver submission while its connection stays held.
// It is not a Railway RTT measurement or a production latency budget.
class DelayedClient extends pg.Client {
  override query: pg.Client['query'] = new Proxy(super.query.bind(this), {
    apply(target, receiver, args: unknown[]) {
      if (addedDelay === 0) return Reflect.apply(target, receiver, args) as unknown;
      if (typeof args.at(-1) === 'function') {
        setTimeout(() => Reflect.apply(target, receiver, args) as unknown, addedDelay);
        return;
      }
      return delay(addedDelay).then(() => Reflect.apply(target, receiver, args) as unknown);
    },
  });
}
async function legacy<T>(path: string): Promise<T> {
  const specifier = '../../src/modules/' + path + '.performance-baseline.ts';
  const module: unknown = await import(specifier);
  return module as T;
}
const normalize = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, v: unknown) => (key === 'generationId' ? '<generation>' : v)),
  );

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'PERF-06–10 native owner measurement',
  () => {
    const db = new CatalogTestDatabase('perf_extensions');
    let measured: PrismaClient;
    beforeAll(async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname))
        throw new Error('Loopback test database required.');
      await db.connect();
      url.pathname = '/' + db.databaseName;
      url.searchParams.delete('schema');
      const pool = new DiagnosticPool({
        connectionString: url.toString(),
        max: poolMax,
        Client: DelayedClient,
      });
      measured = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
    }, 60000);
    afterAll(async () => {
      await measured?.$disconnect();
      await db.disconnect();
    }, 60000);
    it('compares identical responses and records separate warm and refresh samples', async () => {
      if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 40)
        throw new Error('PERF_SAMPLES must be 1–40.');
      if (![1, 2, 3, 10].includes(poolMax) || ![1, 2, 4].includes(readers))
        throw new Error('Unsupported bounded pool/reader test.');
      if (readers > 1 && !process.env.PERF_CASES)
        throw new Error('Select pure read cases explicitly for concurrent measurement.');
      const f = await studioFixture(db.prisma);
      const design = await f.services.designs.create(
        { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
        f.couple,
      );
      for (let n = 0; n < 20; n++) {
        await f.services.designs.saveTemplate(
          {
            templateId: randomUUID(),
            expectedRevision: 0,
            active: true,
            content: f.content,
            idempotencyKey: randomUUID(),
          },
          f.manager,
        );
        await f.services.printOrders.requestPrintOrder(
          f.bookingId,
          { lines: [{ designId: design.designId, quantity: n + 1 }] },
          randomUUID(),
          f.couple,
        );
      }
      const studio = createInvitationStudioServices(
        measured,
        f.storage.provider,
        null,
        'https://wedding.example.test',
        () => f.now,
      );
      const guests = createGuestServices(measured, () => f.now);
      const foundation = new NotificationFoundation(measured, () => f.now);
      const settings = new NotificationSettings(
        foundation,
        guests.identity.resolver,
        createNotificationBookingReader(measured),
      );
      const storage = new FakeStorageProvider();
      const media = createCatalogMediaService(measured, storage);
      const venue = createVenueService(measured);
      await db.prisma.hall.createMany({
        data: Array.from({ length: 19 }, (_, n) => ({
          id: randomUUID(),
          name: `Performance ${n}`,
          nameNormalized: `performance ${n}`,
          description: '',
          maxGuests: 100,
          displayOrder: n + 1,
          updatedByAccountId: f.manager.actorId,
        })),
      });
      const catalog = createCatalogQueryService(measured, media);
      const analytics = createAnalyticsServices(measured, () => f.now);
      const context = {
        authority: 'AUTHENTICATED' as const,
        actorAccountId: f.manager.actorId,
        requestId: randomUUID(),
        causationId: randomUUID(),
      };
      const date = (
        await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })
      ).eventDate
        .toISOString()
        .slice(0, 10);
      const filter = { dateFrom: date, dateTo: date };
      await analytics.projector.refresh(f.manager.actorId, context);
      const cases: {
        name: string;
        current: () => Promise<unknown>;
        before?: () => Promise<unknown>;
        setup?: () => Promise<void>;
      }[] = [
        {
          name: 'templates-20',
          current: () => studio.designs.listTemplates({ limit: 20 }, f.manager),
        },
        {
          name: 'print-orders-20',
          current: () =>
            studio.printOrders.listManagementPrintOrders(
              { bookingId: f.bookingId, limit: 20 },
              f.manager,
            ),
        },
        { name: 'inbox-empty', current: () => settings.inbox(f.couple.accessToken, {}) },
        { name: 'unread-empty', current: () => settings.unread(f.couple.accessToken) },
        { name: 'catalog-halls-no-assets', current: () => catalog.listPublicHalls({ limit: 20 }) },
        {
          name: 'analytics-warm',
          current: () => analytics.service.query('overview', filter, context),
        },
        {
          name: 'analytics-refresh',
          current: () =>
            analytics.projector.refresh(f.manager.actorId, context).then(() => '<generation>'),
        },
        {
          name: 'catalog-halls-with-assets',
          current: () => catalog.listPublicHalls({ limit: 20 }),
          setup: async () => {
            const setupMedia = createCatalogMediaService(db.prisma, storage);
            for (const hall of await db.prisma.hall.findMany())
              await setupMedia.upload({
                assetId: randomUUID(),
                resourceType: 'HALL',
                resourceId: hall.id,
                bytes: f.bytes,
                contentType: 'image/png',
                alternativeText: 'Synthetic hall',
                context: f.ownerContext,
              });
          },
        },
        {
          name: 'inbox-populated',
          current: () => settings.inbox(f.couple.accessToken, {}),
          setup: async () => {
            const recipient = await db.prisma.notificationRecipient.create({
              data: { accountId: f.couple.actorId, purposes: ['CONTRACT'] },
            });
            const intent = await new NotificationFoundation(db.prisma, () => f.now).enqueue({
              eventId: randomUUID(),
              owner: 'booking-lifecycle',
              bookingId: f.bookingId,
              recipientId: recipient.id,
              channel: 'IN_APP',
              purpose: 'CONTRACT',
              templateVersion: 1,
              scheduledAt: f.now.toISOString(),
              data: {},
            });
            await db.prisma.notificationInbox.create({
              data: { intentId: intent.id, accountId: f.couple.actorId, bookingId: f.bookingId },
            });
          },
        },
        { name: 'unread-populated', current: () => settings.unread(f.couple.accessToken) },
      ];
      if (baseline) {
        const { StudioAuthorization: Authorization } = await legacy<{
          StudioAuthorization: typeof StudioAuthorizationClass;
        }>('invitation-studio/infrastructure/studio-authorization');
        const { createInvitationEditorReader: editor } = await legacy<{
          createInvitationEditorReader: typeof EditorReaderFactory;
        }>('identity-access/authorization/invitation-editor.reader');
        const oldAccess = new Authorization(
          studio.guard,
          editor(measured, studio.boundary, studio.identity.resolver),
        );
        const { DesignService } = await legacy<{ DesignService: typeof DesignServiceClass }>(
          'invitation-studio/infrastructure/design.service',
        );
        const oldDesign = new DesignService(studio.designs.repository, oldAccess, () => f.now);
        const { PrintOrderService } = await legacy<{
          PrintOrderService: typeof PrintOrderServiceClass;
        }>('invitation-studio/infrastructure/print-order.service');
        const p = studio.printOrders;
        const oldPrint = new PrintOrderService(
          p.repository,
          oldAccess,
          p.printable,
          p.billing,
          p.booking,
          p.timeline,
          () => f.now,
          p.fulfillment,
        );
        const { createNotificationBookingReader: reader } = await legacy<{
          createNotificationBookingReader: typeof createNotificationBookingReader;
        }>('booking-lifecycle/infrastructure/notification-context.reader');
        const { NotificationSettings: Settings } = await legacy<{
          NotificationSettings: typeof NotificationSettings;
        }>('notifications-automation/application/notification-settings');
        const oldSettings = new Settings(foundation, guests.identity.resolver, reader(measured));
        const { createProjectionRepository } = await legacy<{
          createProjectionRepository: typeof createProjectionRepositoryClass;
        }>('analytics-dashboard/infrastructure/projection.repository');
        const { AnalyticsProjector } = await legacy<{
          AnalyticsProjector: typeof AnalyticsProjectorClass;
        }>('analytics-dashboard/application/projection');
        const { AnalyticsService } = await legacy<{
          AnalyticsService: typeof AnalyticsServiceClass;
        }>('analytics-dashboard/application/analytics.service');
        const oldStore = createProjectionRepository(measured);
        const oldProjector = new AnalyticsProjector(
          analytics.sources,
          oldStore,
          () => f.now,
          analytics.projector.fences,
        );
        const oldAnalytics = new AnalyticsService(
          oldProjector,
          oldStore,
          () => f.now,
          analytics.service.invalidated,
        );
        cases[0]!.before = () => oldDesign.listTemplates({ limit: 20 }, f.manager);
        cases[1]!.before = () =>
          oldPrint.listManagementPrintOrders({ bookingId: f.bookingId, limit: 20 }, f.manager);
        cases[2]!.before = async () => {
          await guests.identity.resolver.resolve(f.couple.accessToken);
          return oldSettings.inbox(f.couple.accessToken, {});
        };
        cases[3]!.before = async () => {
          await guests.identity.resolver.resolve(f.couple.accessToken);
          return oldSettings.unread(f.couple.accessToken);
        };
        cases[4]!.before = async () => {
          const halls = await venue.listActiveHalls();
          return {
            items: await Promise.all(
              halls.slice(0, 20).map(async ({ id, name, description, maxGuests }) => ({
                id,
                name,
                description,
                maxGuests,
                media: await media.listSigned('HALL', id),
              })),
            ),
            nextCursor: halls.length > 20 ? halls[19]!.id : null,
          };
        };
        cases[5]!.before = () => oldAnalytics.query('overview', filter, context);
        cases[6]!.before = () =>
          oldProjector.refresh(f.manager.actorId, context).then(() => '<generation>');
        cases[7]!.before = cases[4]!.before!;
        cases[8]!.before = cases[2]!.before!;
        cases[9]!.before = cases[3]!.before!;
      }
      const samples: { name: string; variant: string; ms: number; queries: number }[] = [];
      const budgets = JSON.parse(
        await readFile('tasks/evidence/performance-regression-budgets.json', 'utf8'),
      ) as {
        queryCeilings: Record<string, number>;
      };
      const selected = process.env.PERF_CASES?.split(',');
      if (selected?.some((name) => !cases.some((c) => c.name === name)))
        throw new Error('Unknown performance case.');
      for (const c of cases) {
        // Setup follows declared case order even when only later cases are measured.
        await c.setup?.();
        if (selected && !selected.includes(c.name)) continue;
        const reference = normalize(await (c.before ?? c.current)());
        expect(normalize(await c.current())).toEqual(reference);
        for (let n = 0; n < sampleCount; n += readers) {
          const variants = c.before
            ? ([
                ['before', c.before],
                ['current', c.current],
              ] as const)
            : ([['current', c.current]] as const);
          for (const [variant, work] of Math.floor(n / readers) % 2
            ? [...variants].reverse()
            : variants) {
            await Promise.all(
              Array.from({ length: Math.min(readers, sampleCount - n) }, async () => {
                const state = newDatabaseDiagnostics(),
                  started = performance.now();
                const value = await withDatabaseDiagnostics(state, work);
                expect(normalize(value)).toEqual(reference);
                if (readers === 1 && variant === 'current') {
                  expect(state.queries).toBeGreaterThan(0);
                  expect(state.queries, `${c.name} driver-command regression`).toBeLessThanOrEqual(
                    budgets.queryCeilings[c.name]!,
                  );
                }
                samples.push({
                  name: c.name,
                  variant,
                  ms: performance.now() - started,
                  queries: state.queries,
                });
              }),
            );
          }
        }
      }
      await mkdir('test-results/performance', { recursive: true });
      await writeFile(
        'test-results/performance/extensions.json',
        JSON.stringify(
          {
            baseline: baseline ?? null,
            node: process.version,
            modelMs: addedDelay,
            poolMax,
            readers,
            sampleCount,
            samples,
          },
          null,
          2,
        ),
      );
    }, 300000);
  },
);
