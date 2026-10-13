import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CatalogTestDatabase, catalogMigrationDatabaseUrl } from './venue-catalog/catalog-test-database.js';
import { notificationFixture } from './notifications-fixture.js';
import { parseEnvironment } from '../../src/config/env.js';
import { createNotificationsRuntime } from '../../src/modules/notifications-automation/notifications.runtime.js';
import { createBookingAutomationPort } from '../../src/modules/booking-lifecycle/application/automation.js';
import { createPrismaBookingAutomationRepository } from '../../src/modules/booking-lifecycle/infrastructure/automation.repository.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('native notification runtime lifecycle', () => {
 const db=new CatalogTestDatabase('ntf_runtime');
 beforeAll(()=>db.connect(),60000); afterAll(()=>db.disconnect());
 async function setup(enabled=false) {
  const x=await notificationFixture(db.prisma), url=new URL(catalogMigrationDatabaseUrl!);
  url.pathname='/'+db.databaseName;
  const config=parseEnvironment({NODE_ENV:'test',DATABASE_URL:url.toString(),PUBLIC_INVITATION_ORIGIN:'https://wedding.example.test',NOTIFICATIONS_WORKER_ENABLED:String(enabled),NOTIFICATIONS_BOOKING_IDS:x.f.bookingId,LOG_LEVEL:'silent'});
  const booking=createBookingAutomationPort(createPrismaBookingAutomationRepository(db.prisma),async()=>{}), invitation=new PrismaInvitationAutomationReader(db.prisma);
  return {x,config,booking,invitation};
 }
 it('disabled runtime runs only on an explicit tick; missing email is unsent/retryable, never a fake receipt',async()=>{
  const {x,config,booking,invitation}=await setup();
  await x.events.consume(x.event('booking.deposit-eligible'));
  const runtime=await createNotificationsRuntime(config,booking,invitation);
  runtime.start();
  await runtime.tick.run();
  expect(await db.prisma.notificationIntent.findFirst({where:{bookingId:x.f.bookingId,purpose:'booking.deposit-eligible'}})).toMatchObject({state:'RETRYABLE_FAILED',providerMessageId:null});
  await runtime.stop(); await runtime.resource.close();
 },30000);
 it('enabled runtime starts once, survives owner recovery failures, drains and can be recreated',async()=>{
  const {config,booking,invitation}=await setup(true), recovery={run:vi.fn(()=>Promise.resolve({attempted:1,failed:1}))};
  const runtime=await createNotificationsRuntime(config,booking,invitation,recovery);
  runtime.start(); runtime.start();
  await vi.waitFor(()=>expect(recovery.run).toHaveBeenCalledOnce(),{timeout:15000});
  await runtime.stop(); await runtime.resource.close();
  expect(recovery.run).toHaveBeenCalledWith(config.notifications!.bookingIds);
  const restarted=await createNotificationsRuntime({...config,notifications:{...config.notifications!,workerEnabled:false}},booking,invitation);
  await restarted.tick.run(); await restarted.resource.close();
 },30000);
 it('disconnects on startup failure before scheduling or dispatch',async()=>{
  const {config,booking,invitation}=await setup();
  await expect(createNotificationsRuntime({...config,notifications:{...config.notifications!,fcm:{project_id:'wedding-test',client_email:'test@example.test',private_key:'invalid-key'}}},booking,invitation)).rejects.toThrow();
 },30000);
});
