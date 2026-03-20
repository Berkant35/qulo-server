import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";
import { diamondService } from "./diamond.service.js";
import { exchangeService } from "./exchange.service.js";
import { matchingService } from "./matching.service.js";
import { NotificationService } from "./notification.service.js";
import { calculatePowerCost, calculateGreenReward } from "../utils/math.js";
import {
  CHAT_QUESTION_POWERS_2,
  CHAT_QUESTION_POWERS_4,
  type PowerName,
} from "../types/index.js";
import { economyConfigService } from "./economy-config.service.js";
import type {
  CreateChatQuestionInput,
  AnswerChatQuestionInput,
  SaveDraftInput,
} from "../validators/chat-question.validator.js";
import type {
  ChatQuestionBase,
  AnswerQuestionResult,
  UsePowerResult,
  HandleTimeoutResult,
  HistoryResponse,
  ChatQuestionHistory,
} from "../types/index.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Match {
  id: string;
  user1_id: string;
  user2_id: string;
  is_active: boolean;
}

type UserTier = "free" | "plus" | "premium";

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

export class ChatQuestionService {
  /* ── Helper: verifyMatchAccess ─────────────────────────────────── */
  private async verifyMatchAccess(userId: string, matchId: string): Promise<Match> {
    assertUuid(userId, "userId");
    assertUuid(matchId, "matchId");

    const { data: match, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active")
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (error || !match) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    return match as Match;
  }

  /* ── Helper: getUserTier ───────────────────────────────────────── */
  private async getUserTier(userId: string): Promise<UserTier> {
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan, status, expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!sub) return "free";

    // Check if subscription is still valid
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
      return "free";
    }

    if (sub.plan === "premium") return "premium";
    if (sub.plan === "plus") return "plus";
    return "free";
  }

  /* ── Helper: fetchQuestion ─────────────────────────────────────── */
  private async fetchQuestion(questionId: string): Promise<ChatQuestionBase & { sender_id: string; match_id: string }> {
    assertUuid(questionId, "questionId");

    const { data: question, error } = await supabase
      .from("chat_questions")
      .select("*")
      .eq("id", questionId)
      .single();

    if (error || !question) {
      throw Errors.SESSION_NOT_FOUND();
    }

    return question as ChatQuestionBase & { sender_id: string; match_id: string };
  }

  /* ── Helper: sanitizeQuestion ──────────────────────────────────── */
  private sanitizeQuestion(question: ChatQuestionBase & { sender_id: string }, userId: string): ChatQuestionBase {
    const isAnswerer = question.sender_id !== userId;
    const isNotAnswered = question.answered_option == null;
    const isCorrect = question.is_correct === true;

    // Clone to avoid mutating the original
    const result: ChatQuestionBase = { ...question };

    // Hide correct_option from answerer if not yet answered
    if (isAnswerer && isNotAnswered) {
      result.correct_option = "";
    }

    // Mark reward as locked (client shows blurred preview)
    result.reward_locked = !isCorrect;

    return result;
  }

  /* ── Helper: fetchPowerFromDB ──────────────────────────────────── */
  private async fetchPower(powerName: string) {
    const { data: power, error } = await supabase
      .from("powers")
      .select("*")
      .eq("name", powerName)
      .eq("is_active", true)
      .single();

    if (error || !power) {
      throw Errors.VALIDATION_ERROR({ powerName: "Power not found or inactive" });
    }

    return power;
  }

  /* ── Helper: tryUseOrSpend ─────────────────────────────────────── */
  private async tryUseOrSpend(
    userId: string,
    powerName: string,
    purpleCost: number,
    reason: string,
    referenceId?: string,
  ): Promise<void> {
    const used = await exchangeService.tryUseInventory(userId, powerName);
    if (!used) {
      await diamondService.spendPurple(userId, purpleCost, reason, referenceId);
    }
  }

  /* ================================================================ */
  /*  createQuestion                                                   */
  /* ================================================================ */
  async createQuestion(
    matchId: string,
    senderId: string,
    data: CreateChatQuestionInput,
  ) {
    const match = await this.verifyMatchAccess(senderId, matchId);

    // ── Chat lock check — cannot create question while another is locked ──
    const { data: lockedQ } = await supabase
      .from("chat_questions")
      .select("id")
      .eq("match_id", matchId)
      .eq("has_chat_lock", true)
      .is("answered_option", null)
      .limit(1)
      .maybeSingle();

    if (lockedQ) {
      throw Errors.CHAT_LOCKED();
    }

    // ── Subscription-aware daily limits ──
    const tier = await this.getUserTier(senderId);
    const config = await economyConfigService.getConfig();
    const limits = config.subscriptionLimits[tier];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayQuestions, error: countErr } = await supabase
      .from("chat_questions")
      .select("id, has_unmatch_risk")
      .eq("match_id", matchId)
      .eq("sender_id", senderId)
      .gte("created_at", todayStart.toISOString());

    if (countErr) {
      console.error("[chat-question] Daily limit check error:", countErr);
      throw Errors.SERVER_ERROR();
    }

    const questionsToday = todayQuestions?.length ?? 0;
    if (questionsToday >= limits.chatQuestionDaily) {
      throw Errors.DAILY_LIMIT_EXCEEDED("chat_questions");
    }

    if (data.has_unmatch_risk) {
      const unmatchRiskToday = (todayQuestions ?? []).filter(
        (q: any) => q.has_unmatch_risk,
      ).length;
      if (unmatchRiskToday >= limits.chatQuestionUnmatchRisk) {
        throw Errors.DAILY_LIMIT_EXCEEDED("unmatch_risk_questions");
      }
    }

    // ── Power Block handling ──
    if (data.use_power_block) {
      const power = await this.fetchPower("POWER_BLOCK");
      const cost = power.purple_cost ?? power.base_cost ?? 0;
      await this.tryUseOrSpend(senderId, "POWER_BLOCK", cost, "chat_question_power_block", matchId);
    }

    // ── NO diamond cost for question creation (FREE) ──

    // ── Insert question ──
    const { data: question, error: insertErr } = await supabase
      .from("chat_questions")
      .insert({
        match_id: matchId,
        sender_id: senderId,
        question_text: data.question_text,
        option_count: data.option_count,
        option_a: data.option_a,
        option_b: data.option_b,
        option_c: data.option_c ?? null,
        option_d: data.option_d ?? null,
        correct_option: data.correct_option,
        time_limit_seconds: data.time_limit_seconds,
        hint_text: data.hint_text ?? null,
        reward_media_url: data.reward_media_url ?? null,
        reward_media_type: data.reward_media_type ?? null,
        has_unmatch_risk: data.has_unmatch_risk,
        has_chat_lock: data.has_chat_lock ?? false,
        has_power_block: data.use_power_block ?? false,
      })
      .select("*")
      .single();

    if (insertErr) {
      console.error("[chat-question] Insert error:", insertErr);
      throw Errors.SERVER_ERROR();
    }

    // ── Insert message marker ──
    const { error: msgErr } = await supabase.from("messages").insert({
      match_id: matchId,
      sender_id: senderId,
      content: `__QUESTION__:${question.id}`,
      is_image: false,
    });

    if (msgErr) {
      console.error("[chat-question] Message insert error:", msgErr);
      // Non-fatal
    }

    // ── Push notification (fire-and-forget) ──
    const otherUserId = match.user1_id === senderId ? match.user2_id : match.user1_id;
    NotificationService.sendPush(otherUserId, "new_message", {}, undefined, {
      actionUrl: `/matches/chat/${matchId}`,
    }).catch(() => {});

    return question;
  }

  /* ================================================================ */
  /*  answerQuestion                                                   */
  /* ================================================================ */
  async answerQuestion(
    questionId: string,
    userId: string,
    selectedOption: "A" | "B" | "C" | "D",
    powerUsed?: string,
    timeSpent?: number,
  ): Promise<AnswerQuestionResult> {
    const question = await this.fetchQuestion(questionId);

    // Cannot answer own question
    if (question.sender_id === userId) {
      throw Errors.VALIDATION_ERROR({ sender: "Cannot answer your own question" });
    }

    // Already answered
    if (question.answered_option != null) {
      throw Errors.ALREADY_ANSWERED();
    }

    // Verify match access
    const match = await this.verifyMatchAccess(userId, question.match_id);

    // ── SKIP power: auto-correct, reward sender, reveal media ──
    if (powerUsed === "SKIP") {
      // Check power block
      if (question.has_power_block && !question.power_block_removed) {
        throw Errors.VALIDATION_ERROR({ power: "Power block is active. Use POWER_UNBLOCK first." });
      }

      const power = await this.fetchPower("SKIP");
      const ecConfig = await economyConfigService.getConfig();
      const cost = calculatePowerCost(power.purple_cost ?? power.base_cost ?? 0, 1, ecConfig.core.questionCountMultipliers);
      await this.tryUseOrSpend(userId, "SKIP", cost, "chat_question_skip", questionId);

      // Calculate green reward for sender (dynamic ratio)
      const greenReward = calculateGreenReward(cost, ecConfig.core.greenDiamondRewardRatio);
      if (greenReward > 0) {
        try {
          await diamondService.earnGreen(
            question.sender_id,
            greenReward,
            "CHAT_QUESTION_SKIP_REWARD",
            questionId,
          );
        } catch (err) {
          console.error("[chat-question] Skip green reward failed:", err);
        }
      }

      // Mark as correct (auto-fill correct answer)
      const { data: updated, error: updateErr } = await supabase
        .from("chat_questions")
        .update({
          answered_option: question.correct_option,
          is_correct: true,
          answered_at: new Date().toISOString(),
          time_spent: timeSpent ?? null,
          powers_used: [...(question.powers_used ?? []), "SKIP"],
        })
        .eq("id", questionId)
        .select("*")
        .single();

      if (updateErr) {
        console.error("[chat-question] Skip update error:", updateErr);
        throw Errors.SERVER_ERROR();
      }

      return {
        question: this.sanitizeQuestion(updated, userId),
        is_correct: true,
        unmatched: false,
        skipped: true,
      };
    }

    // ── Normal answer flow ──
    const isCorrect = selectedOption === question.correct_option;

    const { data: updated, error: updateErr } = await supabase
      .from("chat_questions")
      .update({
        answered_option: selectedOption,
        is_correct: isCorrect,
        answered_at: new Date().toISOString(),
        time_spent: timeSpent ?? null,
      })
      .eq("id", questionId)
      .select("*")
      .single();

    if (updateErr) {
      console.error("[chat-question] Answer update error:", updateErr);
      throw Errors.SERVER_ERROR();
    }

    // Reward sender with green diamonds if correct (dynamic ratio)
    if (isCorrect) {
      // Use a base reward of 10 for free questions
      const ecRewardConfig = await economyConfigService.getConfig();
      const greenReward = calculateGreenReward(10, ecRewardConfig.core.greenDiamondRewardRatio);
      if (greenReward > 0) {
        try {
          await diamondService.earnGreen(
            question.sender_id,
            greenReward,
            "CHAT_QUESTION_REWARD",
            questionId,
          );
        } catch (err) {
          console.error("[chat-question] Diamond reward failed:", err);
        }
      }
    }

    let unmatched = false;

    // If wrong + unmatch risk → unmatch
    if (!isCorrect && question.has_unmatch_risk) {
      try {
        await matchingService.unmatch(question.sender_id, match.id);
        unmatched = true;
      } catch (err) {
        console.error("[chat-question] Unmatch after wrong answer failed:", err);
      }
    }

    // Push notification (fire-and-forget)
    NotificationService.sendPush(
      question.sender_id,
      "chat_question_answered",
      { result: isCorrect ? "correct" : "wrong" },
      undefined,
      { actionUrl: `/matches/chat/${question.match_id}` },
    ).catch(() => {});

    return {
      question: this.sanitizeQuestion(updated, userId),
      is_correct: isCorrect,
      unmatched,
    };
  }

  /* ================================================================ */
  /*  rescueQuestion — SKIP after wrong answer                         */
  /* ================================================================ */
  async rescueQuestion(questionId: string, userId: string): Promise<AnswerQuestionResult> {
    const question = await this.fetchQuestion(questionId);

    if (question.sender_id === userId) {
      throw Errors.VALIDATION_ERROR({ sender: "Only the answerer can rescue" });
    }

    // Must be answered AND wrong
    if (question.answered_option == null || question.is_correct) {
      throw Errors.VALIDATION_ERROR({ state: "Can only rescue a wrong answer" });
    }

    const match = await this.verifyMatchAccess(userId, question.match_id as string);

    // Power block check
    if (question.has_power_block && !question.power_block_removed) {
      throw Errors.VALIDATION_ERROR({ power: "Power block is active. Use POWER_UNBLOCK first." });
    }

    // Pay for SKIP
    const power = await this.fetchPower("SKIP");
    const ecConfig2 = await economyConfigService.getConfig();
    const cost = calculatePowerCost(power.purple_cost ?? power.base_cost ?? 0, 1, ecConfig2.core.questionCountMultipliers);
    await this.tryUseOrSpend(userId, "SKIP", cost, "chat_question_rescue", questionId);

    const greenReward = calculateGreenReward(cost, ecConfig2.core.greenDiamondRewardRatio);
    if (greenReward > 0) {
      try {
        await diamondService.earnGreen(
          question.sender_id as string,
          greenReward,
          "CHAT_QUESTION_RESCUE_REWARD",
          questionId,
        );
      } catch (err) {
        console.error("[chat-question] Rescue green reward failed:", err);
      }
    }

    // Override answer to correct
    const { data: updated, error: updateErr } = await supabase
      .from("chat_questions")
      .update({
        answered_option: question.correct_option,
        is_correct: true,
        powers_used: [...(question.powers_used ?? []), "SKIP_RESCUE"],
      })
      .eq("id", questionId)
      .select("*")
      .single();

    if (updateErr) {
      console.error("[chat-question] Rescue update error:", updateErr);
      throw Errors.SERVER_ERROR();
    }

    return {
      question: this.sanitizeQuestion(updated, userId),
      is_correct: true,
      unmatched: false,
      rescued: true,
    };
  }

  /* ================================================================ */
  /*  usePower                                                         */
  /* ================================================================ */
  async usePower(questionId: string, userId: string, powerName: PowerName): Promise<UsePowerResult> {
    const question = await this.fetchQuestion(questionId);

    // Must be the answerer (not sender)
    if (question.sender_id === userId) {
      throw Errors.VALIDATION_ERROR({ sender: "Only the answerer can use powers" });
    }

    // Already answered
    if (question.answered_option != null) {
      throw Errors.ALREADY_ANSWERED();
    }

    // Verify match access
    await this.verifyMatchAccess(userId, question.match_id as string);

    // Validate power is allowed for this option_count
    const optionCount = question.option_count ?? 2;
    const allowedPowers = optionCount === 4 ? CHAT_QUESTION_POWERS_4 : CHAT_QUESTION_POWERS_2;

    // POWER_UNBLOCK is always allowed if block is active
    if (powerName !== "POWER_UNBLOCK" && !allowedPowers.includes(powerName)) {
      throw Errors.VALIDATION_ERROR({
        power: `${powerName} is not available for ${optionCount}-option questions`,
      });
    }

    const hasPowerBlock = question.has_power_block && !question.power_block_removed;

    // ── POWER_UNBLOCK handling ──
    if (powerName === "POWER_UNBLOCK") {
      if (!hasPowerBlock) {
        throw Errors.VALIDATION_ERROR({ power: "No power block to remove" });
      }

      const power = await this.fetchPower("POWER_UNBLOCK");
      const cost = power.purple_cost ?? power.base_cost ?? 0;
      await this.tryUseOrSpend(userId, "POWER_UNBLOCK", cost, "chat_question_power_unblock", questionId);

      // Green reward for question sender (from special_green_reward)
      const specialReward = power.special_green_reward ?? 0;
      if (specialReward > 0) {
        try {
          await diamondService.earnGreen(
            question.sender_id,
            specialReward,
            "CHAT_QUESTION_UNBLOCK_REWARD",
            questionId,
          );
        } catch (err) {
          console.error("[chat-question] Unblock green reward failed:", err);
        }
      }

      // Update power_block_removed
      const { error: updateErr } = await supabase
        .from("chat_questions")
        .update({
          power_block_removed: true,
          powers_used: [...(question.powers_used ?? []), "POWER_UNBLOCK"],
        })
        .eq("id", questionId);

      if (updateErr) {
        console.error("[chat-question] Power unblock update error:", updateErr);
        throw Errors.SERVER_ERROR();
      }

      return { unblocked: true };
    }

    // ── Block check for normal powers ──
    if (hasPowerBlock) {
      throw Errors.VALIDATION_ERROR({
        power: "Power block is active. Use POWER_UNBLOCK first.",
      });
    }

    // ── Normal power handling (ORACLE, HALF, HINT, TIME_EXTEND) ──
    const power = await this.fetchPower(powerName);
    const ecConfig3 = await economyConfigService.getConfig();
    const cost = calculatePowerCost(power.purple_cost ?? power.base_cost ?? 0, 1, ecConfig3.core.questionCountMultipliers);
    await this.tryUseOrSpend(userId, powerName, cost, `chat_question_power_${powerName.toLowerCase()}`, questionId);

    // Calculate green reward for sender
    const greenReward = calculateGreenReward(cost, ecConfig3.core.greenDiamondRewardRatio);
    if (greenReward > 0) {
      try {
        await diamondService.earnGreen(
          question.sender_id as string,
          greenReward,
          "CHAT_QUESTION_POWER_REWARD",
          questionId,
        );
      } catch (err) {
        console.error("[chat-question] Power green reward failed:", err);
      }
    }

    // ── Apply power effect ──
    let powerResult: Omit<UsePowerResult, 'power_name' | 'power_result'> = {};

    switch (powerName) {
      case "ORACLE": {
        // 70% chance to suggest the correct option
        const accuracyRate = power.accuracy_rate ?? 0.7;
        const isAccurate = Math.random() < accuracyRate;
        const correctOption = question.correct_option;
        const allOptions = optionCount === 4 ? ["A", "B", "C", "D"] : ["A", "B"];
        const wrongOptions = allOptions.filter((o) => o !== correctOption);

        const suggestedOption = isAccurate
          ? correctOption
          : wrongOptions[Math.floor(Math.random() * wrongOptions.length)];

        powerResult = { suggested_option: suggestedOption };
        break;
      }

      case "HALF": {
        // Remove 2 wrong options (only for 4-option questions)
        const correct = question.correct_option;
        const wrong = ["A", "B", "C", "D"].filter((o) => o !== correct);
        // Shuffle wrong options and pick 2 to eliminate
        const shuffled = wrong.sort(() => Math.random() - 0.5);
        const eliminated = shuffled.slice(0, 2);
        powerResult = { eliminated_options: eliminated };
        break;
      }

      case "HINT": {
        powerResult = { hint_text: question.hint_text ?? null };
        break;
      }

      case "TIME_EXTEND": {
        powerResult = { extra_seconds: 15 };
        break;
      }
      case "SKIP": {
        // SKIP via usePower — auto-correct the question
        const { data: updated } = await supabase
          .from("chat_questions")
          .update({
            answered_option: question.correct_option,
            is_correct: true,
            answered_at: new Date().toISOString(),
            powers_used: [...(question.powers_used ?? []), "SKIP"],
          })
          .eq("id", questionId)
          .select("*")
          .single();

        return {
          power_result: { skipped: true },
          cost,
          green_reward: greenReward,
          is_correct: true,
          question: this.sanitizeQuestion(updated, userId),
        };
      }
    }

    // Update powers_used array
    const { error: updateErr } = await supabase
      .from("chat_questions")
      .update({
        powers_used: [...(question.powers_used ?? []), powerName],
      })
      .eq("id", questionId);

    if (updateErr) {
      console.error("[chat-question] Power used update error:", updateErr);
      throw Errors.SERVER_ERROR();
    }

    return { power_name: powerName, ...powerResult };
  }

  /* ================================================================ */
  /*  handleTimeout                                                    */
  /* ================================================================ */
  async handleTimeout(questionId: string, userId: string): Promise<HandleTimeoutResult> {
    const question = await this.fetchQuestion(questionId);

    return {
      can_rescue: true,
      has_power_block: question.has_power_block && !question.power_block_removed,
    };
  }

  /* ================================================================ */
  /*  getQuestion                                                      */
  /* ================================================================ */
  async getQuestion(questionId: string, userId: string) {
    assertUuid(questionId, "questionId");
    assertUuid(userId, "userId");

    const question = await this.fetchQuestion(questionId);

    // Verify user is part of this match
    await this.verifyMatchAccess(userId, question.match_id as string);

    return this.sanitizeQuestion(question, userId);
  }

  // ── Drafts ──
  async saveDraft(userId: string, data: SaveDraftInput) {
    const { data: draft, error } = await supabase
      .from("chat_question_drafts")
      .insert({ user_id: userId, ...data })
      .select("*")
      .single();
    if (error) {
      console.error("[chat-question] saveDraft error:", error);
      throw Errors.SERVER_ERROR();
    }
    return draft;
  }

  async getDrafts(userId: string) {
    const { data, error } = await supabase
      .from("chat_question_drafts")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw Errors.SERVER_ERROR();
    return data ?? [];
  }

  async deleteDraft(userId: string, draftId: string) {
    assertUuid(draftId, "draftId");
    const { error } = await supabase
      .from("chat_question_drafts")
      .delete()
      .eq("id", draftId)
      .eq("user_id", userId);
    if (error) throw Errors.SERVER_ERROR();
    return { success: true };
  }

  // ── History ──
  async getHistory(userId: string, page = 1, limit = 20): Promise<HistoryResponse> {
    const offset = (page - 1) * limit;
    const { data, error, count } = await supabase
      .from("chat_questions")
      .select("id, question_text, option_count, option_a, option_b, option_c, option_d, correct_option, time_limit_seconds, hint_text, has_unmatch_risk, has_chat_lock, created_at", { count: "exact" })
      .eq("sender_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw Errors.SERVER_ERROR();
    return { items: (data as ChatQuestionHistory[]) ?? [], total: count ?? 0, page, limit };
  }
}

export const chatQuestionService = new ChatQuestionService();
