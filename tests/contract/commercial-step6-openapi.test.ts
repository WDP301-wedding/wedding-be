import { expect, it } from 'vitest';
import { createOpenApiDocument } from '../../src/core/openapi/generate.js';
it('publishes mounted appendix, expense and immutable invoice operations with authenticated durable write keys', () => {
  const paths = createOpenApiDocument().paths!;
  const operations = [
    ['/bookings/{bookingId}/contract-appendices', 'get', 'listCommercialAppendices'],
    ['/bookings/{bookingId}/contract-appendices', 'post', 'createCommercialAppendix'],
    [
      '/bookings/{bookingId}/contract-appendices/{revisionId}/submissions',
      'post',
      'submitCommercialAppendix',
    ],
    [
      '/bookings/{bookingId}/contract-appendices/{revisionId}/approvals',
      'post',
      'approveCommercialAppendix',
    ],
    ['/management/bookings/{bookingId}/incidental-expenses', 'post', 'createIncidentalExpense'],
    [
      '/management/bookings/{bookingId}/incidental-expenses/{lineId}',
      'patch',
      'updateIncidentalExpense',
    ],
    [
      '/management/bookings/{bookingId}/incidental-expenses/{lineId}',
      'delete',
      'deleteIncidentalExpense',
    ],
    ['/management/bookings/{bookingId}/final-invoices', 'post', 'finalizeCommercialInvoice'],
    ['/management/bookings/{bookingId}/invoice-adjustments', 'post', 'adjustCommercialInvoice'],
    ['/bookings/{bookingId}/final-invoices', 'get', 'listCommercialInvoices'],
    ['/bookings/{bookingId}/final-invoices/{invoiceRevisionId}', 'get', 'getCommercialInvoice'],
  ] as const;
  for (const [path, method, operationId] of operations) {
    const operation = paths[path]?.[method];
    expect(operation?.operationId).toBe(operationId);
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    if (method !== 'get') {
      expect(operation?.parameters).toContainEqual({
        $ref: '#/components/parameters/IdempotencyKey',
      });
      expect(operation?.requestBody).toMatchObject({
        required: true,
        content: { 'application/json': { schema: { additionalProperties: false } } },
      });
      expect(JSON.stringify(operation?.requestBody)).not.toMatch(
        /"(totalVnd|deltaVnd|actorAccountId|role|issuedAt)"\s*:/,
      );
    }
  }
});
