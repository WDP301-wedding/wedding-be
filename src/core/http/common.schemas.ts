import { z } from 'zod';

export const requestIdSchema = z.uuid().meta({
  id: 'RequestId',
  description: 'UUID used to correlate one HTTP request across responses and telemetry.',
  example: '24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
});

export const errorDetailSchema = z
  .strictObject({
    path: z.string().meta({ example: 'email' }),
    code: z.string().meta({ example: 'invalid_format' }),
    message: z.string().meta({ example: 'Email must be valid.' }),
  })
  .meta({ id: 'ErrorDetail' });

export const errorResponseSchema = z
  .strictObject({
    error: z.strictObject({
      code: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/u)
        .meta({ example: 'VALIDATION_ERROR' }),
      message: z.string().min(1).meta({ example: 'The request is invalid.' }),
      details: z.array(errorDetailSchema).optional(),
      requestId: requestIdSchema,
    }),
  })
  .meta({ id: 'ErrorResponse' });

export const paginationMetadataSchema = z
  .strictObject({
    page: z.int().min(1).meta({ example: 1 }),
    pageSize: z.int().min(1).max(100).meta({ example: 20 }),
    totalItems: z.int().min(0).meta({ example: 0 }),
    totalPages: z.int().min(0).meta({ example: 0 }),
  })
  .meta({
    id: 'PaginationMetadata',
    description: 'Pagination metadata returned by list endpoints.',
  });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type PaginationMetadata = z.infer<typeof paginationMetadataSchema>;
