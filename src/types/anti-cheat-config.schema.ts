// src/types/anti-cheat-config.schema.ts
import { z } from "zod";

const proximityExclusionSchema = z.object({
  enabled: z.boolean(),
  dry_run: z.boolean(),
  rollout_pct: z.number().int().min(0).max(100),
  radius_meters: z.number().int().min(10).max(1000),
  ttl_hours: z.number().int().min(1).max(168),
  ip_match_also: z.boolean(),
  require_location: z.boolean(),
});

const dripQuestionsSchema = z.object({
  enabled: z.boolean(),
  dry_run: z.boolean(),
});

const minThinkTimeSchema = z.object({
  enabled: z.boolean(),
  dry_run: z.boolean(),
  min_seconds: z.number().min(0.5).max(10),
});

const viewerSpecificShuffleSchema = z.object({
  enabled: z.boolean(),
  dry_run: z.boolean(),
});

export const antiCheatConfigSchema = z.object({
  proximity_exclusion: proximityExclusionSchema,
  drip_questions: dripQuestionsSchema,
  min_think_time: minThinkTimeSchema,
  viewer_specific_shuffle: viewerSpecificShuffleSchema,
});

export type AntiCheatConfig = z.infer<typeof antiCheatConfigSchema>;

export interface AntiCheatConfigRow {
  id: number;
  config: AntiCheatConfig;
  updated_at: string;
  updated_by: string | null;
}

export type AntiCheatRule =
  | "proximity_exclusion"
  | "drip_questions"
  | "min_think_time"
  | "viewer_specific_shuffle";

export type AntiCheatOutcome =
  | "BLOCKED"
  | "DRY_RUN_BLOCKED"
  | "ALLOWED"
  | "ERRORED";
