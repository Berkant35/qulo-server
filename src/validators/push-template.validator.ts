import { z } from 'zod';
import { PUSH_TYPES, SUPPORTED_LOCALES } from '../services/notification.service.js';

export const pushTemplateParamsSchema = z.object({
  type: z.enum(PUSH_TYPES as unknown as [string, ...string[]]),
});

export const pushTemplateQuerySchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]),
});

// Reject unknown placeholders. Only allow letters, digits, underscore inside {…}.
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;
const ALLOWED_PLACEHOLDERS = new Set(['name', 'badge', 'result']);

function validatePlaceholders(text: string | null | undefined): boolean {
  if (!text) return true;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (!ALLOWED_PLACEHOLDERS.has(match[1]!)) return false;
  }
  return true;
}

export const pushTemplateBodySchema = z.object({
  title: z.string().trim().min(1).max(120).optional().nullable()
    .refine(validatePlaceholders, { message: 'Title contains an unknown {placeholder}' }),
  body: z.string().trim().min(1).max(280).optional().nullable()
    .refine(validatePlaceholders, { message: 'Body contains an unknown {placeholder}' }),
  is_active: z.boolean(),
}).refine(
  (v) => v.title || v.body || v.is_active === false,
  { message: 'At least one of title/body must be set when is_active is true' },
);

export type PushTemplateBody = z.infer<typeof pushTemplateBodySchema>;
