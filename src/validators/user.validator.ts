import { z } from "zod";
import { SUPPORTED_LOCALES } from '../constants/locales.js';

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  surname: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  age: z.number().int().min(18).max(99).optional(),
  gender_pref: z.enum(["MAN", "WOMAN", "BOTH"]).optional(),
  match_radius_km: z.number().int().min(5).max(500).optional(),
  age_pref_min: z.number().int().min(18).max(99).optional(),
  age_pref_max: z.number().int().min(18).max(99).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
  photos: z.array(z.string().url()).max(6).optional(),
  relationship_goal: z.enum(["SERIOUS", "FRIENDSHIP", "NOT_SURE"]).optional(),
  preferred_languages: z.array(z.enum(["tr", "en", "de", "fr", "ar", "ru", "es"])).min(1).max(7).optional(),
  strict_language_mode: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updateDetailsSchema = z.object({
  height: z.number().int().min(100).max(250).nullable().optional(),
  weight: z.number().int().min(30).max(300).nullable().optional(),
  zodiac: z.string().max(30).nullable().optional(),
  job: z.string().max(100).nullable().optional(),
  school: z.string().max(100).nullable().optional(),
  smoking: z.enum(["YES", "NO", "SOMETIMES"]).nullable().optional(),
  alcohol: z.enum(["YES", "NO", "SOMETIMES"]).nullable().optional(),
  pets: z.string().max(100).nullable().optional(),
  music_type: z.string().max(100).nullable().optional(),
  personality: z.string().max(200).nullable().optional(),
});

export type UpdateDetailsInput = z.infer<typeof updateDetailsSchema>;

export const updateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  city: z.string().max(100).optional(),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const updatePushTokenSchema = z.object({
  push_token: z.string().min(1),
});

export type UpdatePushTokenInput = z.infer<typeof updatePushTokenSchema>;

export const notificationPreferencesSchema = z.object({
  messages: z.boolean().optional(),
  matches: z.boolean().optional(),
  campaigns: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one preference must be provided' },
);

export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
