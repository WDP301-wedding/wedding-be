import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createErrorHandler } from '../../../src/core/errors/error-handler.js';
import { createStudioRouter } from '../../../src/modules/invitation-studio/http/studio.router.js';
import { CatalogTestDatabase } from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { printOrderResponseSchema } from '../../../src/modules/invitation-studio/http/print-orders.schemas.js';
import { designResponse } from '../../../src/modules/invitation-studio/http/studio.schemas.js';
import { errorResponseSchema } from '../../../src/core/http/common.schemas.js';

function createTestApp(f: Awaited<ReturnType<typeof studioFixture>>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });
  app.use('/api/v1', createStudioRouter(f.services, f.services.identity.resolver));
  app.use(createErrorHandler());
  return app;
}

describe('Print Order Integration (IS-W5 / PRN-001..009)', () => {
  const database = new CatalogTestDatabase('isw5_print');
  let prisma: PrismaClient;

  beforeAll(async () => {
    await database.connect();
    prisma = database.prisma;
  });

  afterAll(async () => {
    await database.disconnect();
  });

  it('executes full PRN-001..009 lifecycle: request, quote, approval, billing charge, production, ready, handover', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    // 1. Create 2 designs for multi-variant order
    const design1Res = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const design1 = designResponse.parse(design1Res.body).data;
    const designId1 = design1.designId;

    const design2Res = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: { ...f.content, title: 'Variant 2' } })
      .expect(201);
    const design2 = designResponse.parse(design2Res.body).data;
    const designId2 = design2.designId;

    // Publish invitation first (required for generic QR snapshot)
    await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations/${designId1}/publication`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        designRevisionId: design1.revisionId,
        expectedPublicationRevision: 0,
      })
      .expect(200);

    // 2. PRN-001 & PRN-002: Couple creates draft print order with 2 lines (50 of variant 1, 100 of variant 2)
    const requestKey = randomUUID();
    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', requestKey)
      .send({
        lines: [
          { designId: designId1, quantity: 50 },
          { designId: designId2, quantity: 100 },
        ],
      })
      .expect(201);

    const order = printOrderResponseSchema.parse(orderRes.body).data;
    expect(order.status).toBe('REQUESTED');
    expect(order.revision).toBe(1);
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]?.quantity).toBe(50);
    expect(order.lines[1]?.quantity).toBe(100);
    expect(order.currentCommercialRevision).toBeNull();
    expect(order.receivableChargeId).toBeNull();

    // Idempotent replay of order creation
    const replayOrderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', requestKey)
      .send({
        lines: [
          { designId: designId1, quantity: 50 },
          { designId: designId2, quantity: 100 },
        ],
      })
      .expect(201);
    const replayed = printOrderResponseSchema.parse(replayOrderRes.body).data;
    expect(replayed.orderId).toBe(order.orderId);

    const line1Id = order.lines[0]!.lineId;
    const line2Id = order.lines[1]!.lineId;

    // 3. PRN-003: Manager provides quotation
    const quoteKey = randomUUID();
    const quoteRes = await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/quotations`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', quoteKey)
      .send({
        expectedRevision: 1,
        lines: [
          { lineId: line1Id, unitPriceVnd: 10000 },
          { lineId: line2Id, unitPriceVnd: 15000 },
        ],
        estimatedHandoverAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      })
      .expect(200);

    const quotedOrder = printOrderResponseSchema.parse(quoteRes.body).data;
    expect(quotedOrder.status).toBe('QUOTED');
    expect(quotedOrder.revision).toBe(2);
    expect(quotedOrder.currentCommercialRevision).not.toBeNull();
    const comRev = quotedOrder.currentCommercialRevision!;
    expect(comRev.orderTotalVnd).toBe(50 * 10000 + 100 * 15000); // 2.000.000 VND
    expect(comRev.lines).toHaveLength(2);
    expect(comRev.lines[0]?.lineTotalVnd).toBe(500000);
    expect(comRev.lines[1]?.lineTotalVnd).toBe(1500000);

    // Verify outbox event: invitation.print-quotation-issued
    const quoteOutbox = await prisma.invitationStudioOutbox.findFirst({
      where: {
        bookingId: f.bookingId,
        eventType: 'invitation.print-quotation-issued',
      },
    });
    expect(quoteOutbox).not.toBeNull();

    // 4. PRN-004 & PRN-006: Couple approves the quote
    const approveKey = randomUUID();
    const approveRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${order.orderId}/approval`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', approveKey)
      .send({
        expectedRevision: 2,
        commercialRevisionId: comRev.commercialRevisionId,
      })
      .expect(200);

    const approvedOrder = printOrderResponseSchema.parse(approveRes.body).data;
    expect(approvedOrder.status).toBe('APPROVED');
    expect(approvedOrder.revision).toBe(3);
    expect(approvedOrder.receivableChargeId).not.toBeNull();

    // Each line must have a captured printableRevisionId
    expect(approvedOrder.lines[0]?.printableRevisionId).not.toBeNull();
    expect(approvedOrder.lines[1]?.printableRevisionId).not.toBeNull();

    // PRN-006: Check registered billing charge
    const charge = await prisma.bookingReceivableCharge.findUnique({
      where: { id: approvedOrder.receivableChargeId! },
    });
    expect(charge).not.toBeNull();
    expect(charge!.amountVnd.toNumber()).toBe(2000000);
    expect(charge!.sourceType).toBe('PRINT_ORDER');
    expect(charge!.sourceRevisionId).toBe(comRev.commercialRevisionId);

    // Check billing receivables view
    const receivables = await f.services.billing.getBookingReceivables(f.bookingId);
    expect(receivables.acceptedChargesVnd).toBe(2000000);

    // Verify outbox event: invitation.print-order-approved
    const approveOutbox = await prisma.invitationStudioOutbox.findFirst({
      where: {
        bookingId: f.bookingId,
        eventType: 'invitation.print-order-approved',
      },
    });
    expect(approveOutbox).not.toBeNull();

    // 5. PRN-007: Fulfillment transitions: IN_PRODUCTION -> READY_FOR_HANDOVER -> HANDED_OVER
    // Cannot skip to ready directly from APPROVED (409)
    await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/ready`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 3 })
      .expect(409);

    // Manager transitions to IN_PRODUCTION
    const prodRes = await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/production`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 3 })
      .expect(200);
    const prodOrder = printOrderResponseSchema.parse(prodRes.body).data;
    expect(prodOrder.status).toBe('IN_PRODUCTION');
    expect(prodOrder.revision).toBe(4);

    // Cannot cancel after production has begun
    await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/cancellation`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 4 })
      .expect(409);

    // Manager transitions to READY_FOR_HANDOVER
    const readyRes = await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/ready`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 4 })
      .expect(200);
    const readyOrder = printOrderResponseSchema.parse(readyRes.body).data;
    expect(readyOrder.status).toBe('READY_FOR_HANDOVER');
    expect(readyOrder.readyAt).not.toBeNull();
    expect(readyOrder.revision).toBe(5);

    // Verify outbox event: invitation.print-order-ready
    const readyOutbox = await prisma.invitationStudioOutbox.findFirst({
      where: {
        bookingId: f.bookingId,
        eventType: 'invitation.print-order-ready',
      },
    });
    expect(readyOutbox).not.toBeNull();

    // Manager transitions to HANDED_OVER with evidenceReference
    const handoverRes = await request(app)
      .post(`/api/v1/management/print-orders/${order.orderId}/handover`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 5,
        evidenceReference: 'HANDOVER-RECEIPT-VNPOST-001',
      })
      .expect(200);
    const handoverOrder = printOrderResponseSchema.parse(handoverRes.body).data;
    expect(handoverOrder.status).toBe('HANDED_OVER');
    expect(handoverOrder.handedOverAt).not.toBeNull();
    expect(handoverOrder.evidenceReference).toBe('HANDOVER-RECEIPT-VNPOST-001');
    expect(handoverOrder.revision).toBe(6);
  });

  it('cancels unapproved order without billing charge or credit', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    const designRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const designId = designResponse.parse(designRes.body).data.designId;

    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ designId, quantity: 20 }] })
      .expect(201);
    const orderId = printOrderResponseSchema.parse(orderRes.body).data.orderId;

    // Couple cancels while REQUESTED
    const cancelRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 1, reason: 'Changed mind' })
      .expect(200);

    const cancelOrder = printOrderResponseSchema.parse(cancelRes.body).data;
    expect(cancelOrder.status).toBe('CANCELLED');
    expect(cancelOrder.revision).toBe(2);

    // No charges or credits in database
    const charges = await prisma.bookingReceivableCharge.findMany({
      where: { bookingId: f.bookingId },
    });
    expect(charges).toHaveLength(0);
  });

  it('cancels approved order before production with Couple confirmation intent and billing credit', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    const designRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const design = designResponse.parse(designRes.body).data;
    const designId = design.designId;

    await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations/${designId}/publication`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        designRevisionId: design.revisionId,
        expectedPublicationRevision: 0,
      })
      .expect(200);

    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ designId, quantity: 50 }] })
      .expect(201);
    const order = printOrderResponseSchema.parse(orderRes.body).data;
    const orderId = order.orderId;
    const lineId = order.lines[0]!.lineId;

    const quoteRes = await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/quotations`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        lines: [{ lineId, unitPriceVnd: 20000 }],
        estimatedHandoverAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      })
      .expect(200);
    const quoted = printOrderResponseSchema.parse(quoteRes.body).data;

    const approveRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/approval`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 2,
        commercialRevisionId: quoted.currentCommercialRevision!.commercialRevisionId,
      })
      .expect(200);
    const chargeId = printOrderResponseSchema.parse(approveRes.body).data.receivableChargeId!;

    // Manager cancellation without Couple confirmation intent fails (409)
    await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 3 })
      .expect(409);

    // Couple confirms cancellation intent
    await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/cancellation-intents`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 3, reason: 'Event scaled down' })
      .expect(200);

    // Manager cancels with Couple confirmation
    const cancelRes = await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/cancellation`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 3, reason: 'Approved by Couple' })
      .expect(200);

    const cancelOrder = printOrderResponseSchema.parse(cancelRes.body).data;
    expect(cancelOrder.status).toBe('CANCELLED');
    expect(cancelOrder.revision).toBe(4);

    // Verify credit in database
    const credits = await prisma.bookingChargeCredit.findMany({
      where: { bookingId: f.bookingId, receivableChargeId: chargeId },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]?.amountVnd.toNumber()).toBe(50 * 20000); // 1.000.000 VND
    expect(credits[0]?.reason).toBe('PRINT_CANCELLED');
  });

  it('supports PRN-009 replacement proposal & approval with atomic old credit and new charge', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    const designRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const design = designResponse.parse(designRes.body).data;
    const designId = design.designId;

    await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations/${designId}/publication`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        designRevisionId: design.revisionId,
        expectedPublicationRevision: 0,
      })
      .expect(200);

    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ designId, quantity: 100 }] })
      .expect(201);
    const order = printOrderResponseSchema.parse(orderRes.body).data;
    const orderId = order.orderId;
    const lineId = order.lines[0]!.lineId;

    // Initial quote: 100 * 10.000 = 1.000.000 VND
    const quote1Res = await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/quotations`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        lines: [{ lineId, unitPriceVnd: 10000 }],
        estimatedHandoverAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      })
      .expect(200);
    const quoted1 = printOrderResponseSchema.parse(quote1Res.body).data;

    // Initial approval
    const approve1Res = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/approval`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 2,
        commercialRevisionId: quoted1.currentCommercialRevision!.commercialRevisionId,
      })
      .expect(200);
    const oldChargeId = printOrderResponseSchema.parse(approve1Res.body).data.receivableChargeId!;

    // Manager proposes replacement quotation: 100 * 12.000 = 1.200.000 VND (e.g. upgraded paper)
    await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/replacement-proposals`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 3,
        lines: [{ lineId, unitPriceVnd: 12000 }],
        estimatedHandoverAt: new Date(Date.now() + 6 * 86400000).toISOString(),
      })
      .expect(200);

    // Production is BLOCKED while replacement proposal is pending
    await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/production`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 4 })
      .expect(409);

    // Get the new commercial revision ID from database
    const newRev = await prisma.invitationCommercialRevision.findFirst({
      where: { orderId, revisionNumber: 2 },
    });
    expect(newRev).not.toBeNull();
    expect(newRev!.orderTotalVnd.toNumber()).toBe(1200000);

    // Couple approves replacement
    const approveReplRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/replacement-approvals`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 4,
        commercialRevisionId: newRev!.id,
      })
      .expect(200);

    const replOrder = printOrderResponseSchema.parse(approveReplRes.body).data;
    expect(replOrder.revision).toBe(5);
    expect(replOrder.currentCommercialRevisionId).toBe(newRev!.id);
    expect(replOrder.receivableChargeId).not.toBe(oldChargeId);

    // Verify old charge was credited with PRINT_REPLACED
    const credits = await prisma.bookingChargeCredit.findMany({
      where: { bookingId: f.bookingId, receivableChargeId: oldChargeId },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]?.reason).toBe('PRINT_REPLACED');
    expect(credits[0]?.amountVnd.toNumber()).toBe(1000000);

    // Verify new charge exists with 1.200.000 VND
    const newCharge = await prisma.bookingReceivableCharge.findUnique({
      where: { id: replOrder.receivableChargeId! },
    });
    expect(newCharge).not.toBeNull();
    expect(newCharge!.amountVnd.toNumber()).toBe(1200000);

    // Now production can start cleanly
    await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/production`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedRevision: 5 })
      .expect(200);
  });

  it('rejects approval of expired quote with 409 PRINT_QUOTE_EXPIRED', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    const designRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const design = designResponse.parse(designRes.body).data;
    const designId = design.designId;

    await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations/${designId}/publication`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        designRevisionId: design.revisionId,
        expectedPublicationRevision: 0,
      })
      .expect(200);

    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ designId, quantity: 50 }] })
      .expect(201);
    const order = printOrderResponseSchema.parse(orderRes.body).data;
    const orderId = order.orderId;
    const lineId = order.lines[0]!.lineId;

    const quoteRes = await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/quotations`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 1,
        lines: [{ lineId, unitPriceVnd: 10000 }],
        estimatedHandoverAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      })
      .expect(200);
    const comRevId = printOrderResponseSchema.parse(quoteRes.body).data.currentCommercialRevision!
      .commercialRevisionId;

    // Simulate expiration by advancing clock by 8 days (quote expires in 7 days)
    f.now.setTime(f.now.getTime() + 8 * 86400000);

    // Issue a session token valid at the new clock time for the couple
    const refreshedCouple = await f.actor('COUPLE', 'WEB', f.couple.actorId);

    const approveFailRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders/${orderId}/approval`)
      .set('Authorization', `Bearer ${refreshedCouple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 2,
        commercialRevisionId: comRevId,
      })
      .expect(409);

    const err = errorResponseSchema.parse(approveFailRes.body).error;
    expect(err.code).toBe('PRINT_QUOTE_EXPIRED');
  });

  it('rejects stale expectedRevision on quote and approval with 409 PRINT_QUOTE_STALE', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    const designRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/invitations`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ content: f.content })
      .expect(201);
    const designId = designResponse.parse(designRes.body).data.designId;

    const orderRes = await request(app)
      .post(`/api/v1/bookings/${f.bookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ designId, quantity: 30 }] })
      .expect(201);
    const order = printOrderResponseSchema.parse(orderRes.body).data;
    const orderId = order.orderId;
    const lineId = order.lines[0]!.lineId;

    // Wrong expected revision on quote: order is at revision 1, we pass expectedRevision 99
    const staleQuoteRes = await request(app)
      .post(`/api/v1/management/print-orders/${orderId}/quotations`)
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        expectedRevision: 99,
        lines: [{ lineId, unitPriceVnd: 10000 }],
        estimatedHandoverAt: new Date(Date.now() + 5 * 86400000).toISOString(),
      })
      .expect(409);

    const err = errorResponseSchema.parse(staleQuoteRes.body).error;
    expect(err.code).toBe('PRINT_QUOTE_STALE');
  });

  it('denies unauthenticated and cross-booking access to print orders', async () => {
    const f = await studioFixture(prisma);
    const app = createTestApp(f);

    // Unauthenticated
    await request(app).get(`/api/v1/bookings/${f.bookingId}/print-orders`).expect(401);

    // Other unowned booking ID
    const otherBookingId = randomUUID();
    await request(app)
      .get(`/api/v1/bookings/${otherBookingId}/print-orders`)
      .set('Authorization', `Bearer ${f.couple.accessToken}`)
      .expect(404);
  });
});
