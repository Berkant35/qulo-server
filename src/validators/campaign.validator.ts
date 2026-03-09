import { z } from "zod";

export const segmentSchema = z.object({
  gender: z.enum(["MAN", "WOMAN"]).optional(),
  age_min: z.number().int().min(18).max(99).optional(),
  age_max: z.number().int().min(18).max(99).optional(),
  cities: z.array(z.string()).optional(),
  subscription_plan: z.string().optional(),
  last_active_days: z.number().int().min(1).optional(),
  profile_completion_min: z.number().int().min(0).max(100).optional(),
  profile_completion_max: z.number().int().min(0).max(100).optional(),
  has_match: z.boolean().optional(),
  registered_after: z.string().optional(),
});

export type SegmentInput = z.infer<typeof segmentSchema>;

export const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  push_title: z.string().min(1).max(100),
  push_body: z.string().min(1).max(500),
  image_url: z.string().url().optional(),
  action_url: z.string().max(200).optional(),
  action_label: z.string().max(50).optional(),
  segment: segmentSchema,
  scheduled_at: z.string().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
