import type { ZodOpenApiObject } from 'zod-openapi';
import type { ZodType } from 'zod';
import * as s from './print-orders.schemas.js';

const errors = Object.fromEntries(
  ['400', '401', '403', '404', '409', '422', '429', '500', '502', '503', '504'].map((status, i) => [
    status,
    {
      $ref: `#/components/responses/${['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'UnprocessableEntity', 'TooManyRequests', 'InternalServerError', 'BadGateway', 'ServiceUnavailable', 'GatewayTimeout'][i]}`,
    },
  ]),
);

function operation(
  operationId: string,
  summary: string,
  response: ZodType,
  params: string[],
  body?: ZodType,
  status = '200',
) {
  return {
    operationId,
    summary,
    tags: ['Invitation Print Orders'],
    security: [{ bearerAuth: [] }],
    parameters: [
      ...params.map((name) => ({
        name,
        in: 'path' as const,
        required: true,
        schema: {
          type: 'string' as const,
          format: 'uuid',
        },
      })),
      ...(body === undefined ? [] : [{ $ref: '#/components/parameters/IdempotencyKey' }]),
    ],
    ...(body === undefined
      ? {}
      : { requestBody: { required: true, content: { 'application/json': { schema: body } } } }),
    responses: {
      [status]: {
        description: 'Validated response.',
        content: { 'application/json': { schema: response } },
      },
      ...errors,
    },
  };
}

export const invitationPrintOrdersOpenApiPaths = {
  '/bookings/{bookingId}/print-orders': {
    post: operation(
      'requestPrintOrder',
      'Own FULL Couple creates draft physical invitation print order',
      s.printOrderResponseSchema,
      ['bookingId'],
      s.requestPrintOrderBodySchema,
      '201',
    ),
    get: {
      ...operation(
        'listPrintOrders',
        'Couple lists print orders for booking',
        s.printOrderListResponseSchema,
        ['bookingId'],
      ),
      requestParams: { query: s.printOrderListQuerySchema },
    },
  },
  '/bookings/{bookingId}/print-orders/{orderId}': {
    get: operation('getPrintOrder', 'Couple views print order detail', s.printOrderResponseSchema, [
      'bookingId',
      'orderId',
    ]),
  },
  '/bookings/{bookingId}/print-orders/{orderId}/approval': {
    post: operation(
      'approvePrintOrder',
      'Couple approves active quotation; contracted print references the existing contract obligation, legacy print registers a charge',
      s.printOrderResponseSchema,
      ['bookingId', 'orderId'],
      s.approvePrintOrderBodySchema,
    ),
  },
  '/bookings/{bookingId}/print-orders/{orderId}/cancellation-intents': {
    post: operation(
      'recordPrintOrderCancellationIntent',
      'Couple confirms intent to cancel approved print order before production',
      s.cancellationIntentResponseSchema,
      ['bookingId', 'orderId'],
      s.cancellationIntentBodySchema,
    ),
  },
  '/bookings/{bookingId}/print-orders/{orderId}/cancellation': {
    post: operation(
      'cancelPrintOrderCouple',
      'Couple cancels unapproved print order without billing charges',
      s.printOrderResponseSchema,
      ['bookingId', 'orderId'],
      s.cancelOrderBodySchema,
    ),
  },
  '/bookings/{bookingId}/print-orders/{orderId}/replacement-approvals': {
    post: operation(
      'approvePrintOrderReplacement',
      'Couple approves replacement quote: credits old charge and creates new charge',
      s.printOrderResponseSchema,
      ['bookingId', 'orderId'],
      s.replacementApprovalBodySchema,
    ),
  },
  '/management/print-orders': {
    get: {
      ...operation(
        'listManagementPrintOrders',
        'Manager lists print orders across bookings',
        s.printOrderListResponseSchema,
        [],
      ),
      requestParams: { query: s.managementPrintOrderListQuerySchema },
    },
  },
  '/management/print-orders/{orderId}': {
    get: operation(
      'getManagementPrintOrder',
      'Manager views single print order detail',
      s.printOrderResponseSchema,
      ['orderId'],
    ),
  },
  '/management/print-orders/{orderId}/quotations': {
    post: operation(
      'quotePrintOrder',
      'Manager quotes exact frozen contract prices (including zero) with safe integer VND totals; legacy quotes retain unit price 1–1000000 and total 1–1000000000000 VND',
      s.printOrderResponseSchema,
      ['orderId'],
      s.quotePrintOrderBodySchema,
    ),
  },
  '/management/print-orders/{orderId}/production': {
    post: operation(
      'startPrintOrderProduction',
      'Manager transitions approved print order to production',
      s.printOrderResponseSchema,
      ['orderId'],
      s.transitionOrderBodySchema,
    ),
  },
  '/management/print-orders/{orderId}/ready': {
    post: operation(
      'markPrintOrderReady',
      'Manager transitions print order to ready for handover',
      s.printOrderResponseSchema,
      ['orderId'],
      s.transitionOrderBodySchema,
    ),
  },
  '/management/print-orders/{orderId}/handover': {
    post: operation(
      'markPrintOrderHandedOver',
      'Manager completes print order handover with evidence reference',
      s.printOrderResponseSchema,
      ['orderId'],
      s.handoverOrderBodySchema,
    ),
  },
  '/management/print-orders/{orderId}/cancellation': {
    post: operation(
      'cancelPrintOrderManagement',
      'Manager cancels print order; registers credit if order was approved',
      s.printOrderResponseSchema,
      ['orderId'],
      s.cancelOrderBodySchema,
    ),
  },
  '/management/print-orders/{orderId}/replacement-proposals': {
    post: operation(
      'proposePrintOrderReplacement',
      'Manager proposes replacement quote for approved order; blocks production until decided',
      s.printOrderResponseSchema,
      ['orderId'],
      s.replacementProposalBodySchema,
    ),
  },
} satisfies NonNullable<ZodOpenApiObject['paths']>;

export const invitationPrintOrdersOpenApiSchemas = {
  PrintOrder: s.printOrderResponseSchema,
  PrintOrderList: s.printOrderListResponseSchema,
  PrintOrderCancellationIntent: s.cancellationIntentResponseSchema,
};
