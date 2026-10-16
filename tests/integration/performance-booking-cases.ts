import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import type { DatabaseDiagnostics } from '../../src/core/database/diagnostics.js';
import { createLogger } from '../../src/core/logging/logger.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import { createGuestRouter } from '../../src/modules/guest-management/http/guest.router.js';
import { createSeatingRouter } from '../../src/modules/seating-plan/http/seating.router.js';
import { createStaffRouter } from '../../src/modules/staff-operations/http/staff.router.js';
import { createStudioRouter } from '../../src/modules/invitation-studio/http/studio.router.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { createAuthenticatedActorResolver } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { createPaymentsBillingProviders } from '../../src/modules/payments-billing/payments-billing.providers.js';
import { createPaymentsBillingRouter } from '../../src/modules/payments-billing/http/payments-billing.router.js';
import { createPaymentsBillingHttpServices } from '../../src/modules/payments-billing/http/payments-billing.http-services.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';
import { controlledVnpay } from './payments-billing/vnpay-fixture.js';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import type { GuestRequestContext } from '../../src/modules/guest-management/application/guest.contracts.js';
import { catalogMigrationDatabaseUrl } from './venue-catalog/catalog-test-database.js';

export function registerPerformanceBookingCases(
  h: StepSixApiHarness,
  context: (who: 'own' | 'manager' | 'staff') => GuestRequestContext,
) {
  it('PERF-02 initialized native-owner fixture has stable booking/Staff reads and correlated driver work', async () => {
    // paidFixture uses the real local Manager manual-accounting API and approvals.
    // No direct FULL grants, settled-row injection, external payment or AI operation.
    const { f } = await h.paidFixture();
    const booking = await h.database.prisma.booking.findUniqueOrThrow({
      where: { id: f.id },
      include: { proposalSnapshot: true },
    });
    const clock = new Date(
      `${booking.eventDate.toISOString().slice(0, 10)}T${booking.proposalSnapshot!.shiftStartTime.toISOString().slice(11, 16)}:00+07:00`,
    );
    const expiresAt = new Date(clock.getTime() + 86400000);
    await h.database.prisma.session.updateMany({
      where: { accountId: { in: Object.values(h.accounts) } },
      data: { idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt },
    });
    await h.database.prisma.accessCredential.updateMany({
      where: { session: { accountId: { in: Object.values(h.accounts) } } },
      data: { expiresAt },
    });
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + h.database.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.delete('options');
    const prisma = createPrismaClient(url.toString(), true);
    try {
      const studio = createInvitationStudioServices(
        prisma,
        controlledStorage().provider,
        null,
        'https://wedding.example.test',
        () => clock,
      );
      const combined = createStaffSeatingServices(prisma, studio, () => clock);
      const couple = context('own'),
        manager = context('manager');
      const initializationStart = performance.now();
      const [group] = await combined.staff.guests.guests.groups(f.id, couple);
      await combined.staff.guests.guests.createGuest(
        f.id,
        { guestGroupId: group!.guestGroupId, name: 'Khách tổng hợp' },
        randomUUID(),
        couple,
      );
      await combined.staff.staff.assign(
        f.id,
        { staffAccountId: h.accounts.staff!, expectedRevision: 0 },
        randomUUID(),
        manager,
      );
      await combined.staff.staff.configure(
        f.id,
        { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
        randomUUID(),
        couple,
      );
      const options = await combined.seating.seating.options(f.id, couple);
      const layout = options.items.find((item) => item.compatible)!;
      expect(layout).toBeDefined();
      const plan = await combined.seating.seating.select(
        f.id,
        {
          layoutTemplateVersionId: layout.layoutTemplateVersionId,
          expectedBookingRevision: options.bookingRevision,
        },
        randomUUID(),
        couple,
      );
      await combined.seating.seating.confirm(
        f.id,
        plan.seatingPlanId,
        { expectedRevision: plan.revisionNumber, expectedBookingRevision: options.bookingRevision },
        randomUUID(),
        couple,
      );
      await studio.designs.create(
        {
          bookingId: f.id,
          content: {
            title: 'Synthetic performance invitation',
            textFields: {},
            sections: [],
            derivedAssetIds: [],
            includesSeating: false,
          },
          idempotencyKey: randomUUID(),
        },
        couple,
      );
      const initializationMs = performance.now() - initializationStart;
      const logs = new Map<string, { durationMs: number; database: DatabaseDiagnostics }>();
      const logger = createLogger({
        level: 'info',
        runtimeEnvironment: 'test',
        destination: {
          write(line) {
            const row = JSON.parse(line) as {
              event: string;
              requestId: string;
              durationMs: number;
              database: DatabaseDiagnostics;
            };
            if (row.event === 'http_request_completed') logs.set(row.requestId, row);
          },
        },
      });
      const resolver = createAuthenticatedActorResolver(
        createPrismaSessionRepository(prisma),
        () => clock,
      );
      const billing = createPaymentsBillingProviders(prisma, {
        vnpay: controlledVnpay,
        gateway: {
          query: () => Promise.reject(new Error('No external provider in local performance test')),
        },
      });
      const app = createApp({
        runtimeEnvironment: 'test',
        databaseDiagnosticsEnabled: true,
        logger,
        securityConfig: {
          replicaCount: 1,
          bodyLimitBytes: 1048576,
          requestTimeoutMs: 30000,
          rateLimit: { maxRequests: 1000, windowMs: 60000 },
        },
        registerRoutes(server) {
          server.use('/api/v1', createGuestRouter(combined.staff.guests));
          server.use(
            '/api/v1',
            createSeatingRouter(combined.seating.seating, combined.seating.resolver),
          );
          server.use('/api/v1', createStaffRouter(combined.staff));
          server.use('/api/v1', createStudioRouter(studio, resolver));
          server.use(
            '/api/v1',
            createPaymentsBillingRouter({
              services: createPaymentsBillingHttpServices(prisma, billing),
              resolveActor: resolver,
            }),
          );
        },
      });
      const cases = [
        ...[
          'guest-groups',
          'guests?limit=20',
          'guest-plan',
          'seating-plans/current',
          'seating-layout-options',
          'invitations?limit=20',
          'billing',
        ].map((suffix) => ({
          path: `/api/v1/bookings/${f.id}/${suffix}`,
          route: suffix,
          token: couple.accessToken,
        })),
        {
          path: `/api/v1/staff/events/${f.id}/guests/search?query=${encodeURIComponent('Khách')}&limit=20`,
          route: 'assigned-guest-search',
          token: context('staff').accessToken,
        },
      ];
      const counts = async () => ({
        booking: await prisma.booking.findUnique({
          where: { id: f.id },
          select: { revision: true, planningHeadcount: true, phase: true },
        }),
        ledger: await prisma.billingLedgerEntry.findMany({
          where: { bookingId: f.id },
          orderBy: { id: 'asc' },
        }),
        contracts: await prisma.commercialContractRevision.findMany({
          where: { bookingId: f.id },
          orderBy: { id: 'asc' },
        }),
        invoices: await prisma.finalInvoiceRevision.findMany({
          where: { bookingId: f.id },
          orderBy: { id: 'asc' },
        }),
        workspace: await prisma.guestWorkspace.findUnique({ where: { bookingId: f.id } }),
        seating: await prisma.seatingPlan.findUnique({ where: { bookingId: f.id } }),
        staff: await prisma.staffConfiguration.findUnique({ where: { bookingId: f.id } }),
        audit: await prisma.auditLog.count(),
        guestHistory: await prisma.guestHistory.count({ where: { bookingId: f.id } }),
        seatingHistory: await prisma.seatingPlanRevision.count({ where: { bookingId: f.id } }),
        staffHistory: await prisma.staffHistory.count({ where: { bookingId: f.id } }),
      });
      const before = await counts();
      const samples: object[] = [];
      const rounds = process.env.PERF_SAMPLES === '20' ? 20 : 2;
      for (let round = 0; round <= rounds; round++)
        for (const item of cases) {
          const started = performance.now();
          const response = await request(app).get(item.path).auth(item.token, { type: 'bearer' });
          expect(response.status, `${item.route}: ${JSON.stringify(response.body)}`).toBe(200);
          const log = logs.get(response.headers['x-request-id'] as string);
          expect(log?.database.queries).toBeGreaterThan(0);
          expect(log?.database.errors).toBe(0);
          const data = (response.body as { data: unknown }).data;
          const items = Array.isArray(data) ? data : (data as { items?: unknown[] })?.items;
          samples.push({
            route: item.route,
            phase: round === 0 ? 'initial-probe' : 'steady',
            round,
            status: response.status,
            itemCount: items?.length ?? null,
            clientMs: performance.now() - started,
            serverMs: log!.durationMs,
            database: log!.database,
          });
        }
      expect(await counts()).toEqual(before);
      await mkdir('test-results/performance', { recursive: true });
      await writeFile(
        'test-results/performance/booking-local.json',
        JSON.stringify(
          {
            source:
              'loopback PostgreSQL + normal owner APIs; synthetic manual-accounting evidence only; no real settlement/provider acceptance',
            initializationMs,
            rounds,
            steadyStateUnchanged: true,
            samples,
          },
          null,
          2,
        ),
      );
    } finally {
      await prisma.$disconnect();
    }
  }, 120000);
}
