import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import type { CreateQuestionInput, UpdateQuestionInput } from "../validators/question.validator.js";
import { aiSuggestService } from './ai-suggest.service.js';
import { subscriptionService } from './subscription.service.js';
import type { SubscriptionPlan } from '../types/index.js';

// Minimum number of questions a user must have to be discoverable + to leave
// the profile-setup gate. Aligns with discover filter (migration 028).
const MIN_REQUIRED_QUESTIONS = 2;

export class QuestionService {
  async getMyQuestions(userId: string) {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("user_id", userId)
      .order("order_num", { ascending: true });

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return data;
  }

  async createQuestion(userId: string, input: CreateQuestionInput) {
    // Check count against subscription tier limit
    const [{ count, error: countError }, sub] = await Promise.all([
      supabase.from("questions").select("*", { count: "exact", head: true }).eq("user_id", userId),
      subscriptionService.getStatus(userId),
    ]);

    if (countError) {
      throw Errors.SERVER_ERROR();
    }

    const limits = await subscriptionService.getLimits(sub.plan);
    if ((count ?? 0) >= limits.maxQuestions) {
      throw Errors.MAX_QUESTIONS_REACHED();
    }

    const { data, error } = await supabase
      .from("questions")
      .insert({
        user_id: userId,
        order_num: input.order_num,
        question_text: input.question_text,
        correct_answer: input.correct_answer,
        answer_1: input.answer_1,
        answer_2: input.answer_2,
        answer_3: input.answer_3,
        answer_4: input.answer_4,
        hint_text: input.hint_text ?? null,
        category: input.category ?? null,
        time_limit: input.time_limit ?? 30,
        locale: input.locale || 'tr',
      })
      .select("*")
      .single();

    if (error) {
      // Unique constraint violation (user_id, order_num)
      if (error.code === "23505") {
        throw new AppError("DUPLICATE_ORDER_NUM", 409, "Question with this order number already exists");
      }
      throw Errors.SERVER_ERROR();
    }

    // Fire-and-forget: track if this question came from AI suggestion bank
    aiSuggestService.trackSelection(
      input.locale || 'tr',
      input.question_text,
    ).catch(() => {}); // Never block question creation

    return data;
  }

  /**
   * Quick-assigns up to MIN_REQUIRED_QUESTIONS - currentCount questions to the
   * user, pulling from the profile-based AI question bank. Used by the profile
   * setup gate so users can leave setup with the minimum viable quiz.
   *
   * - Respects subscription `maxQuestions` headroom (won't exceed cap).
   * - Skips AI lookup entirely when no slot is needed (idempotent for callers).
   * - Migration 028 trigger keeps `users.question_count` in sync after insert.
   */
  async quickAssignQuestions(userId: string) {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("question_count, locale, subscription_plan")
      .eq("id", userId)
      .single();

    if (userErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    const currentCount = user.question_count ?? 0;
    const locale = user.locale ?? "tr";
    const plan = (user.subscription_plan ?? null) as SubscriptionPlan | null;
    const limits = await subscriptionService.getLimits(plan);

    const headroom = Math.max(0, limits.maxQuestions - currentCount);
    const needed = Math.min(
      Math.max(0, MIN_REQUIRED_QUESTIONS - currentCount),
      headroom,
    );

    if (needed === 0) {
      return { assignedCount: 0, assignedQuestionIds: [] as string[] };
    }

    const suggestions = await aiSuggestService.getProfileBasedSuggestions(
      userId,
      locale,
      needed,
    );

    if (!suggestions || suggestions.length === 0) {
      throw Errors.QUICK_ASSIGN_NO_BANK_MATCH();
    }

    const rows = suggestions.slice(0, needed).map((s, i) => ({
      user_id: userId,
      order_num: currentCount + i + 1,
      question_text: s.question_text,
      answer_1: s.answers[0],
      answer_2: s.answers[1],
      answer_3: s.answers[2],
      answer_4: s.answers[3],
      correct_answer: s.correct_answer, // already 1-indexed from ai-suggest
      hint_text: s.hint ?? null,
      category: s.category ?? null,
      locale,
      time_limit: 30,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("questions")
      .insert(rows)
      .select("id");

    if (insertErr) {
      throw Errors.SERVER_ERROR();
    }

    return {
      assignedCount: inserted?.length ?? 0,
      assignedQuestionIds: (inserted ?? []).map((q: { id: string }) => q.id),
    };
  }

  async updateQuestion(userId: string, orderNum: number, input: UpdateQuestionInput) {
    const updateData: Record<string, unknown> = { ...input };
    // Only include category/time_limit/locale if explicitly provided
    if (input.category !== undefined) updateData.category = input.category;
    if (input.time_limit !== undefined) updateData.time_limit = input.time_limit;
    if (input.locale !== undefined) updateData.locale = input.locale;

    const { data, error } = await supabase
      .from("questions")
      .update(updateData)
      .eq("user_id", userId)
      .eq("order_num", orderNum)
      .select("*")
      .single();

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    if (!data) {
      throw Errors.SESSION_NOT_FOUND();
    }

    return data;
  }

  async deleteQuestion(userId: string, orderNum: number) {
    const { error, count } = await supabase
      .from("questions")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("order_num", orderNum);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    if (count === 0) {
      throw Errors.SESSION_NOT_FOUND();
    }

    // Reorder remaining questions to fill the gap
    await this.reorderQuestions(userId);
  }

  private async reorderQuestions(userId: string) {
    const { data: remaining, error } = await supabase
      .from("questions")
      .select("id, order_num")
      .eq("user_id", userId)
      .order("order_num", { ascending: true });

    if (error || !remaining) return;

    const updates = remaining
      .map((q, i) => ({ id: q.id, expectedOrder: i + 1, currentOrder: q.order_num }))
      .filter((u) => u.currentOrder !== u.expectedOrder);

    for (const u of updates) {
      await supabase
        .from("questions")
        .update({ order_num: u.expectedOrder })
        .eq("id", u.id);
    }
  }

  async reorderByIds(userId: string, orderedIds: string[]) {
    const { data: existing, error } = await supabase
      .from("questions")
      .select("id")
      .eq("user_id", userId);

    if (error) throw Errors.SERVER_ERROR();

    const existingIds = new Set(existing.map((q) => q.id));
    const inputIds = new Set(orderedIds);

    if (existingIds.size !== inputIds.size || !orderedIds.every((id) => existingIds.has(id))) {
      throw new AppError("INVALID_REORDER", 400, "Order must contain exactly all question IDs");
    }

    // Use RPC function for atomic reorder (single transaction, DEFERRED constraint)
    const { error: rpcError } = await supabase.rpc('reorder_questions', {
      p_user_id: userId,
      p_ordered_ids: orderedIds,
    });

    if (rpcError) throw Errors.SERVER_ERROR();

    return this.getMyQuestions(userId);
  }

  async getQuestionCount(userId: string) {
    const { count, error } = await supabase
      .from("questions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return { count: count ?? 0 };
  }

  async getQuestionAnalytics(userId: string) {
    const { data: questions, error } = await supabase
      .from("questions")
      .select("*")
      .eq("user_id", userId)
      .order("order_num", { ascending: true });

    if (error) throw Errors.SERVER_ERROR();

    const analytics = (questions ?? []).map(q => {
      const totalAttempts = q.stats_correct + q.stats_wrong;
      const successRate = totalAttempts > 0
        ? Math.round((q.stats_correct / totalAttempts) * 100)
        : 0;
      const avgTime = q.stats_solve_count > 0
        ? Math.round(q.stats_total_time_spent / q.stats_solve_count)
        : 0;

      let difficultyBadge = 'unranked';
      if (totalAttempts >= 10) {
        if (successRate > 70) difficultyBadge = 'easy';
        else if (successRate > 40) difficultyBadge = 'medium';
        else if (successRate > 20) difficultyBadge = 'hard';
        else difficultyBadge = 'legendary';
      }

      return {
        order_num: q.order_num,
        question_text: q.question_text,
        category: q.category,
        time_limit: q.time_limit,
        locale: q.locale,
        stats: {
          correct: q.stats_correct,
          wrong: q.stats_wrong,
          total_attempts: totalAttempts,
          success_rate: successRate,
          solve_count: q.stats_solve_count,
          avg_time: avgTime,
          green_earned: q.stats_green_earned,
          answer_distribution: {
            answer_1: q.stats_answer_1_count,
            answer_2: q.stats_answer_2_count,
            answer_3: q.stats_answer_3_count,
            answer_4: q.stats_answer_4_count,
          },
          powers: {
            copy: q.stats_copy_used,
            half: q.stats_half_used,
            hint: q.stats_hint_used,
            time_extend: q.stats_time_extend_used,
            skip: q.stats_skip_used,
          },
        },
        difficulty_badge: difficultyBadge,
      };
    });

    const totals = {
      total_solve_count: analytics.reduce((s, a) => s + a.stats.solve_count, 0),
      total_green_earned: analytics.reduce((s, a) => s + a.stats.green_earned, 0),
      overall_success_rate: (() => {
        const totalCorrect = analytics.reduce((s, a) => s + a.stats.correct, 0);
        const totalAttempts = analytics.reduce((s, a) => s + a.stats.total_attempts, 0);
        return totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
      })(),
      best_question_order: analytics.length > 0
        ? analytics.reduce((best, a) => a.stats.green_earned > (best?.stats.green_earned ?? 0) ? a : best, analytics[0])?.order_num ?? null
        : null,
    };

    return { questions: analytics, totals };
  }

  async getWeeklyReport(userId: string) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sessions } = await supabase
      .from("quiz_sessions")
      .select("id")
      .eq("target_id", userId)
      .gte("started_at", weekAgo);

    const { data: greenTx } = await supabase
      .from("diamond_transactions")
      .select("amount")
      .eq("user_id", userId)
      .eq("type", "GREEN")
      .eq("reason", "POWER_REWARD")
      .gte("created_at", weekAgo);

    const weeklyGreenEarned = (greenTx ?? []).reduce((s, t) => s + t.amount, 0);

    const { data: questions } = await supabase
      .from("questions")
      .select("order_num, question_text, stats_correct, stats_wrong")
      .eq("user_id", userId);

    let hardestQuestion: { order_num: number; question_text: string; success_rate: number } | null = null;
    let lowestRate = 101;
    for (const q of questions ?? []) {
      const total = q.stats_correct + q.stats_wrong;
      if (total >= 5) {
        const rate = (q.stats_correct / total) * 100;
        if (rate < lowestRate) {
          lowestRate = rate;
          hardestQuestion = { order_num: q.order_num, question_text: q.question_text, success_rate: Math.round(rate) };
        }
      }
    }

    return {
      week_start: weekAgo,
      total_solves: (sessions ?? []).length,
      green_earned: weeklyGreenEarned,
      hardest_question: hardestQuestion,
    };
  }
}

export const questionService = new QuestionService();
