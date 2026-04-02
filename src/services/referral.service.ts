import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { economyConfigService } from "./economy-config.service.js";
import { Errors } from "../utils/errors.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

export class ReferralService {
  generateCode(): string {
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  async generateUniqueCode(): Promise<string> {
    let attempt = 0;
    while (attempt < 50) {
      const code = this.generateCode();

      const { data, error } = await supabase
        .from("users")
        .select("id")
        .eq("referral_code", code)
        .maybeSingle();

      if (error) continue; // DB error — don't count this attempt

      if (!data) return code;

      attempt++;
    }

    throw new Error("generateUniqueCode: exhausted 50 attempts generating unique referral code");
  }

  async applyReferralCode(refereeId: string, code: string) {
    const upperCode = code.toUpperCase();

    // Find referrer by code
    const { data: referrer, error: referrerErr } = await supabase
      .from("users")
      .select("id, name")
      .eq("referral_code", upperCode)
      .eq("is_deleted", false)
      .maybeSingle();

    if (referrerErr || !referrer) {
      throw Errors.INVALID_REFERRAL_CODE();
    }

    // Cannot refer yourself
    if (referrer.id === refereeId) {
      throw Errors.SELF_REFERRAL();
    }

    // Check if referee already has a referrer
    const { data: existingReferral } = await supabase
      .from("referrals")
      .select("id")
      .eq("referee_id", refereeId)
      .maybeSingle();

    if (existingReferral) {
      throw Errors.ALREADY_REFERRED();
    }

    // Create pending referral
    const { error: insertErr } = await supabase
      .from("referrals")
      .insert({
        referrer_id: referrer.id,
        referee_id: refereeId,
        status: "pending",
      });

    if (insertErr) {
      throw Errors.SERVER_ERROR();
    }

    return { referrerId: referrer.id, referrerName: referrer.name };
  }

  async checkAndReward(userId: string, profileCompletion: number) {
    if (profileCompletion < 60) return;

    // Find pending referral where this user is the referee
    const { data: referral } = await supabase
      .from("referrals")
      .select("id, referrer_id")
      .eq("referee_id", userId)
      .eq("status", "pending")
      .maybeSingle();

    if (!referral) return;

    // Atomically complete the referral — only updates if still pending
    // This prevents double-reward from concurrent calls
    const { data: updated, error: updateErr } = await supabase
      .from("referrals")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", referral.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (updateErr || !updated) return;

    const config = await economyConfigService.getConfig();
    const referralReward = config.rewards.referralPurple;
    const maxCompleted = config.rewards.maxCompletedReferrals;

    // Reward referee (always)
    try {
      await diamondService.addPurple(
        userId,
        referralReward,
        "REFERRAL_REWARD_REFEREE",
        referral.id,
      );
      await supabase
        .from("referrals")
        .update({ referee_rewarded: true })
        .eq("id", referral.id);
    } catch {
      // Best effort
    }

    // Reward referrer only if <= max completed referrals
    const { count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referral.referrer_id)
      .eq("status", "completed");

    if ((count ?? 0) <= maxCompleted) {
      try {
        await diamondService.addPurple(
          referral.referrer_id,
          referralReward,
          "REFERRAL_REWARD_REFERRER",
          referral.id,
        );
        await supabase
          .from("referrals")
          .update({ referrer_rewarded: true })
          .eq("id", referral.id);
      } catch {
        // Best effort
      }
    }
  }

  async getStats(userId: string) {
    const config = await economyConfigService.getConfig();
    const maxCompleted = config.rewards.maxCompletedReferrals;

    const { count: total } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId);

    const { count: pending } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("status", "pending");

    const { count: completed } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", userId)
      .eq("status", "completed");

    const completedCount = completed ?? 0;
    const remaining = Math.max(0, maxCompleted - completedCount);

    return {
      total: total ?? 0,
      pending: pending ?? 0,
      completed: completedCount,
      remaining,
    };
  }

  async getHistory(userId: string) {
    const { data, error } = await supabase
      .from("referrals")
      .select("id, referee_id, status, created_at, completed_at")
      .eq("referrer_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    // Fetch referee names
    const refereeIds = (data ?? []).map((r) => r.referee_id);

    if (refereeIds.length === 0) return [];

    const { data: users } = await supabase
      .from("users")
      .select("id, name")
      .in("id", refereeIds);

    const nameMap = new Map((users ?? []).map((u) => [u.id, u.name]));

    return (data ?? []).map((r) => ({
      id: r.id,
      refereeName: nameMap.get(r.referee_id) ?? "Unknown",
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  }

  async validateCode(code: string) {
    const upperCode = code.toUpperCase();

    const { data: referrer } = await supabase
      .from("users")
      .select("id, name")
      .eq("referral_code", upperCode)
      .eq("is_deleted", false)
      .maybeSingle();

    if (!referrer) {
      return { valid: false };
    }

    return { valid: true, referrerName: referrer.name };
  }

  async getMyReferrer(userId: string) {
    const { data: referral } = await supabase
      .from("referrals")
      .select("referrer_id, status")
      .eq("referee_id", userId)
      .maybeSingle();

    if (!referral) {
      return { referrerName: null, status: null };
    }

    const { data: referrer } = await supabase
      .from("users")
      .select("name")
      .eq("id", referral.referrer_id)
      .single();

    return {
      referrerName: referrer?.name ?? "Unknown",
      status: referral.status,
    };
  }
}

export const referralService = new ReferralService();
