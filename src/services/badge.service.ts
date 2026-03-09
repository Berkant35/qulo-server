import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { AppError, Errors } from "../utils/errors.js";

type BadgeLevel = "SILVER" | "GOLD";

const BADGE_CONFIG: Record<BadgeLevel, { minCompletion: number; reward: number }> = {
  SILVER: { minCompletion: 60, reward: 3 },
  GOLD: { minCompletion: 85, reward: 10 },
};

export class BadgeService {
  async claimReward(userId: string, level: BadgeLevel) {
    const { data: user, error } = await supabase
      .from("users")
      .select("profile_completion, badge_rewards_claimed")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    const config = BADGE_CONFIG[level];
    if (!config) {
      throw new AppError("INVALID_BADGE_LEVEL", 400, "Invalid badge level");
    }

    if (user.profile_completion < config.minCompletion) {
      throw new AppError("BADGE_THRESHOLD_NOT_MET", 400, "Profile completion too low for this badge");
    }

    const claimed: string[] = user.badge_rewards_claimed ?? [];
    if (claimed.includes(level)) {
      throw new AppError("BADGE_ALREADY_CLAIMED", 400, "Badge reward already claimed");
    }

    await diamondService.addPurple(userId, config.reward, `BADGE_${level}`);

    claimed.push(level);
    const { error: updateError } = await supabase
      .from("users")
      .update({ badge_rewards_claimed: claimed })
      .eq("id", userId);

    if (updateError) {
      throw Errors.SERVER_ERROR();
    }

    return {
      level,
      diamonds_awarded: config.reward,
      badge_rewards_claimed: claimed,
    };
  }
}

export const badgeService = new BadgeService();
