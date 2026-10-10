import { z } from 'zod';

export const coupleNameSchema = z
  .string()
  .overwrite((value) => value.trim().normalize('NFC'))
  .min(1)
  .max(120);

export const coupleProfileFields = {
  brideName: coupleNameSchema.optional(),
  groomName: coupleNameSchema.optional(),
};
