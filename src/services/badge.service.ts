import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { AppError, Errors } from "../utils/errors.js";
import { economyConfigService } from "./economy-config.service.js";
import { DEFAULT_BADGE_REWARDS, type BadgeLevel } from "../types/economy-config.schema.js";

/** Eşikler kodda sabit; ÖDÜL miktarı ekonomi config'ten (`rewards.badges`) gelir. */
const BADGE_MIN_COMPLETION: Record<BadgeLevel, number> = { SILVER: 60, GOLD: 85 };

/** Config okunamazsa yedek (`DEFAULT_BADGE_REWARDS`) — rozet talebi config hatasıyla düşmesin. */
async function badgeReward(level: BadgeLevel): Promise<number> {
  try {
    return (await economyConfigService.getConfig()).rewards.badges[level];
  } catch (err) {
    console.error("[badge] economy config okunamadi, yedek odul kullaniliyor:", err);
    return DEFAULT_BADGE_REWARDS[level];
  }
}

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

    const minCompletion = BADGE_MIN_COMPLETION[level];
    if (minCompletion === undefined) {
      throw new AppError("INVALID_BADGE_LEVEL", 400, "Invalid badge level");
    }

    if (user.profile_completion < minCompletion) {
      throw new AppError("BADGE_THRESHOLD_NOT_MET", 400, "Profile completion too low for this badge");
    }

    const claimed: string[] = user.badge_rewards_claimed ?? [];
    if (claimed.includes(level)) {
      throw new AppError("BADGE_ALREADY_CLAIMED", 400, "Badge reward already claimed");
    }

    const reward = await badgeReward(level);
    await diamondService.addPurple(userId, reward, `BADGE_${level}`, `BADGE_${level}`);

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
      diamonds_awarded: reward,
      badge_rewards_claimed: claimed,
    };
  }
}

export const badgeService = new BadgeService();
