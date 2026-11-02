import { z } from 'zod';

/** Declarative, versioned recipe. Never accept generated HTML, CSS, scripts or URLs. */
export const invitationPresentationSchema = z.strictObject({
  version: z.literal(1),
  theme: z.enum([
    'royal-burgundy',
    'sage-minimalist',
    'blush-floral',
    'traditional-red',
    'celestial-navy',
    'champagne-luxury',
  ]),
  layout: z.enum(['envelope', 'gatefold', 'album']),
});
export const invitationDesignPromptSchema = z.strictObject({
  prompt: z.string().trim().min(10).max(2000),
});
export const invitationDesignSuggestionSchema = z.strictObject({
  presentation: invitationPresentationSchema,
  title: z.string().min(1).max(120),
  greeting: z.string().min(1).max(300),
  message: z.string().min(1).max(2000),
  footer: z.string().max(500),
});
export const invitationDesignSuggestionResponse = z.object({
  data: invitationDesignSuggestionSchema,
});
