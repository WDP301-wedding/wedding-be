import { z } from 'zod';

import { requestIdSchema } from './common.schemas.js';

export const healthLiveResponseSchema = z
  .object({
    data: z
      .object({
        status: z.literal('live'),
        requestId: requestIdSchema,
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'HealthLiveResponse' });

export const healthReadyResponseSchema = z
  .object({
    data: z
      .object({
        status: z.literal('ready'),
        requestId: requestIdSchema,
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'HealthReadyResponse' });

export const healthUnavailableResponseSchema = z
  .object({
    error: z
      .object({
        code: z.literal('SERVICE_UNAVAILABLE'),
        message: z.literal('The service is not ready.'),
        requestId: requestIdSchema,
      })
      .strict(),
  })
  .strict()
  .meta({ id: 'HealthUnavailableResponse' });

export type HealthLiveResponse = z.infer<typeof healthLiveResponseSchema>;
export type HealthReadyResponse = z.infer<typeof healthReadyResponseSchema>;
