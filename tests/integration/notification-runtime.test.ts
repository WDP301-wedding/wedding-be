import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { Registry } from 'prom-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { createLogger } from '../../src/core/logging/logger.js';
import { createNotificationsRuntime } from '../../src/modules/notifications-automation/notifications.runtime.js';
import { NotificationWorker } from '../../src/modules/notifications-automation/application/notification-worker.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification runtime composition and disabled channel boundary',
  () => {
    const db = new CatalogTestDatabase('notification_runtime');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('mounts real current-identity settings while a disabled worker rejects queued Guest delivery', async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + db.databaseName;
      const config = parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() });
      const f = await studioFixture(db.prisma);
      const runtime = await createNotificationsRuntime(
        config,
        createLogger({ level: 'silent', runtimeEnvironment: 'test' }),
        new Registry(),
      );
      try {
        const app = createApp({
          runtimeEnvironment: 'test',
          registerRoutes: (a) => a.use('/api/v1', runtime.router),
        });
        runtime.start();
        expect(
          (
            await request(app)
              .get('/api/v1/notifications/preferences')
              .set('Authorization', `Bearer ${f.couple.accessToken}`)
          ).status,
        ).toBe(200);
        expect(
          (
            await request(app)
              .post(`/api/v1/bookings/${f.bookingId}/guests/${randomUUID()}/delivery`)
              .set('Authorization', `Bearer ${f.couple.accessToken}`)
              .send({ expectedRevision: 0, intendedEmail: 'explicit@example.invalid' })
          ).status,
        ).toBe(503);
        expect(
          (
            await request(app)
              .get('/api/v1/management/notifications/recipient')
              .set('Authorization', `Bearer ${f.manager.accessToken}`)
          ).status,
        ).toBe(200);
        expect(
          (
            await request(app)
              .get('/api/v1/notifications/android-installations')
              .set('Authorization', `Bearer ${f.couple.accessToken}`)
          ).status,
        ).toBe(200);
      } finally {
        await runtime.resource.close();
      }
      // Native pool teardown is idempotent and does not leave a running worker.
      await runtime.resource.close();
    }, 30000);
    it('composes encryption and enables only the explicitly configured worker lifecycle', async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + db.databaseName;
      const config = parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        BREVO_API_KEY: 'controlled-key',
        BREVO_FROM_EMAIL: 'sender@example.invalid',
        NOTIFICATIONS_WORKER_ENABLED: 'true',
        NOTIFICATIONS_CREDENTIAL_KEYS: JSON.stringify({ v1: randomBytes(32).toString('base64') }),
        NOTIFICATIONS_ACTIVE_KEY_VERSION: 'v1',
        NOTIFICATIONS_FCM_ENABLED: 'true',
        NOTIFICATIONS_FCM_SERVICE_ACCOUNT: JSON.stringify({
          type: 'service_account',
          project_id: 'wedding-test',
          client_email: 'worker@example.invalid',
          private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
            .privateKey.export({ type: 'pkcs8', format: 'pem' })
            .toString(),
        }),
      });
      const start = vi.spyOn(NotificationWorker.prototype, 'start').mockImplementation(() => {});
      try {
        const runtime = await createNotificationsRuntime(
          config,
          createLogger({ level: 'silent', runtimeEnvironment: 'test' }),
          new Registry(),
        );
        runtime.start();
        expect(start).toHaveBeenCalledOnce();
        await runtime.resource.close();
      } finally {
        start.mockRestore();
      }
    }, 30000);
    it('fails composition on a refused database connection and releases its owned resources', async () => {
      const config = parseEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
      });
      await expect(
        createNotificationsRuntime(
          config,
          createLogger({ level: 'silent', runtimeEnvironment: 'test' }),
          new Registry(),
        ),
      ).rejects.toThrow();
    }, 30000);
  },
);
