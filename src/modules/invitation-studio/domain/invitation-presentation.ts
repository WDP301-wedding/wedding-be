import { z } from 'zod';

const motifSchema = z.enum([
  'peony',
  'lotus',
  'botanical',
  'art-deco',
  'celestial',
  'orchid',
  'cloud',
  'ginkgo',
]);
const compositionSchema = z.enum(['diagonal', 'crown', 'border']);
const densitySchema = z.enum(['subtle', 'ornate']);
const decorationSchema = z.strictObject({
  coverMotif: motifSchema,
  insideMotif: motifSchema,
  frame: z.enum(['double-line', 'arch', 'corners']),
  finish: z.enum(['letterpress', 'gold-foil', 'silk']),
  coverComposition: compositionSchema.optional(),
  insideComposition: compositionSchema.optional(),
  coverDensity: densitySchema.optional(),
  insideDensity: densitySchema.optional(),
});

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
  decoration: decorationSchema.optional(),
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

export const generatedInvitationDesignSchema = invitationDesignSuggestionSchema.extend({
  presentation: invitationPresentationSchema.omit({ version: true, layout: true }).extend({
    decoration: decorationSchema.required({
      coverComposition: true,
      insideComposition: true,
      coverDensity: true,
      insideDensity: true,
    }),
  }),
});
