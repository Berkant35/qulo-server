import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../constants/locales.js';

export const setUserLanguagesSchema = z.object({
  languages: z.array(
    z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]])
  ).min(1, 'At least one language is required'),
});
