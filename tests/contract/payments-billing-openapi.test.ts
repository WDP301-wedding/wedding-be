import { describe, expect, it } from 'vitest';
import {
  createOpenApiDocument,
  serializeOpenApiDocument,
} from '../../src/core/openapi/generate.js';

describe('PB-C3 billing HTTP contract', () => {
  it('publishes all seven approved operations with authentication and durable write keys', () => {
    const paths = createOpenApiDocument().paths ?? {};
    const expected = [
      ['/bookings/{bookingId}/payments/deposit', 'post', 'createDepositPayment'],
      ['/bookings/{bookingId}/payments/balance', 'post', 'createBalancePayment'],
      ['/bookings/{bookingId}/payments/{attemptId}', 'get', 'getPaymentAttempt'],
      ['/management/billing/payments/manual', 'post', 'recordManualPayment'],
      ['/management/billing/refunds', 'post', 'recordBillingRefund'],
      ['/bookings/{bookingId}/billing', 'get', 'getBookingBilling'],
      ['/billing/callbacks/vnpay', 'get', 'receiveVnpayIpn'],
    ] as const;
    for (const [path, method, operationId] of expected) {
      const operation = paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual(
        operationId === 'receiveVnpayIpn' ? [] : [{ bearerAuth: [] }],
      );
      if (method === 'post')
        expect(operation?.parameters).toContainEqual({
          $ref: '#/components/parameters/IdempotencyKey',
        });
    }
  });
  it('publishes strict request/response schemas without monetary authority overrides', () => {
    const schemas = createOpenApiDocument().components?.schemas ?? {};
    const manual = schemas.BillingManualPaymentBody;
    expect(manual).toMatchObject({ additionalProperties: false });
    const text = JSON.stringify(manual);
    expect(text).not.toMatch(
      /timelineRevisionId|expectedBillingRevision|commandId|approvedRefundableVnd|roles/,
    );
    const refund = JSON.stringify(schemas.BillingRefundBody);
    expect(refund).not.toMatch(/decisionId|approvedRefundableVnd|recordedAt|bookingId/);
    expect(JSON.stringify(schemas.BillingAttemptResponse)).not.toMatch(
      /evidenceReference|terminalEvidenceId|SecureHash|hashSecret/,
    );
  });
  it('documents raw provider IPN and fixed-fence pagination and generates deterministically', () => {
    const document = createOpenApiDocument();
    const callback = document.paths?.['/billing/callbacks/vnpay']?.get;
    expect(JSON.stringify(callback?.responses?.['200'])).toContain('BillingIpnResponse');
    expect(callback?.parameters).not.toContainEqual({
      $ref: '#/components/parameters/IdempotencyKey',
    });
    expect(callback?.parameters).toContainEqual(
      expect.objectContaining({ name: 'vnp_SecureHash', in: 'query', required: true }),
    );
    expect(callback?.parameters).toContainEqual(
      expect.objectContaining({ name: 'vnp_Amount', in: 'query', required: true }),
    );
    const read = document.paths?.['/bookings/{bookingId}/billing']?.get;
    expect(JSON.stringify(read?.parameters)).toMatch(/limit/);
    expect(JSON.stringify(read?.parameters)).toMatch(/throughBillingRevision/);
    expect(serializeOpenApiDocument(document)).toBe(
      serializeOpenApiDocument(createOpenApiDocument()),
    );
  });
});
