import { z } from "zod";
import { segmentSchema, type SegmentInput } from "./segment.validator.js";

export { segmentSchema };
export type { SegmentInput };

export const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  push_title: z.string().min(1).max(100),
  push_body: z.string().min(1).max(500),
  image_url: z.string().url().optional(),
  action_url: z.string().max(200).optional(),
  action_label: z.string().max(50).optional(),
  segment: segmentSchema,
  scheduled_at: z.string().refine(
    (v) => !isNaN(Date.parse(v)),
    { message: "Must be a valid date string" },
  ).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
