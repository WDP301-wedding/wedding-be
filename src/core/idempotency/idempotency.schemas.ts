import { z } from 'zod';

export const idempotencyKeySchema = z
  .string()
  .regex(/^[\x20-\x7e]{1,128}$/u)
  .meta({
    id: 'IdempotencyKey',
    description:
      'A 1–128 character printable ASCII key that identifies one client intent and is reused for retries of that intent.',
    example: 'booking:24dcfaac-4408-4d42-8d66-456ed6ee7ea4',
  });
