import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { calculatePowerCost, calculateGreenReward, shuffleArray } from "../utils/math.js";
import { diamondService } from "./diamond.service.js";
import { exchangeService } from "./exchange.service.js";
import { NotificationService } from "./notification.service.js";
import { userLanguageService } from "./user-language.service.js";
import type { PowerName } from "../types/index.js";

interface SessionRow {
  id: string;
  solver_id: string;
  target_id: string;
  status: string;
  current_q: number;
  total_questions: number;
  expires_at: string;
  completed_at: string | null;
}

interface QuestionRow {
  id: string;
  user_id: string;
  order_num: number;
  question_text: string;
  correct_answer: number;
  answer_1: string;
  answer_2: string;
  answer_3: string;
  answer_4: string;
  hint_text: string | null;
  stats_correct: number;
  stats_wrong: number;
}

interface PowerRow {
  id: string;
  name: string;
  base_cost: number;
  is_active: boolean;
}

export class QuizService {
  // ─── Start Session ─────────────────────────────────────────────
  async startSession(solverId: string, targetId: string) {
    // 1. Fetch target's questions with locale
    const { data: allQuestions, error: qErr } = await supabase
      .from("questions")
      .select("id, time_limit, locale")
      .eq("user_id", targetId)
      .order("order_num", { ascending: true });

    if (qErr) throw Errors.SERVER_ERROR();
    if (!allQuestions || allQuestions.length < 2) throw Errors.NO_QUESTIONS();

    // Filter questions by solver's languages
    const solverLanguages = await userLanguageService.getUserLanguages(solverId);
    let filteredQuestions = allQuestions;
    if (solverLanguages.length > 0) {
      filteredQuestions = allQuestions.filter((q: any) =>
        solverLanguages.includes(q.locale || 'tr')
      );
    }

    const totalQuestions = filteredQuestions.length;
    if (totalQuestions < 2) throw Errors.NO_QUESTIONS();

    // 2. Check no active IN_PROGRESS session for this solver+target pair
    const { data: existing, error: existErr } = await supabase
      .from("quiz_sessions")
      .select("id")
      .eq("solver_id", solverId)
      .eq("target_id", targetId)
      .eq("status", "IN_PROGRESS")
      .maybeSingle();

    if (existErr) throw Errors.SERVER_ERROR();

    if (existing) {
      return { session_id: existing.id as string, total_questions: totalQuestions };
    }

    // 3. Create session — dynamic expires_at based on per-question time_limits
    const totalTimeLimit = filteredQuestions.reduce(
      (sum: number, q: any) => sum + (q.time_limit ?? 30), 0
    );
    // Add 10s buffer for network latency
    const expiresAt = new Date(Date.now() + (totalTimeLimit + 10) * 1000).toISOString();

    const { data: session, error: createErr } = await supabase
      .from("quiz_sessions")
      .insert({
        solver_id: solverId,
        target_id: targetId,
        status: "IN_PROGRESS",
        current_q: 1,
        total_questions: totalQuestions,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (createErr || !session) throw Errors.SERVER_ERROR();

    return { session_id: session.id as string, total_questions: totalQuestions };
  }

  // ─── Get Current Question ──────────────────────────────────────
  async getCurrentQuestion(sessionId: string, solverId: string) {
    const session = await this.getActiveSession(sessionId, solverId);

    // Get target's questions ordered by order_num
    const { data: questions, error: qErr } = await supabase
      .from("questions")
      .select("id, order_num, question_text, answer_1, answer_2, answer_3, answer_4, hint_text, time_limit, locale")
      .eq("user_id", session.target_id)
      .order("order_num", { ascending: true });

    if (qErr || !questions || questions.length === 0) throw Errors.SERVER_ERROR();

    // Filter by solver's languages
    const solverLanguages = await userLanguageService.getUserLanguages(solverId);
    let filteredQuestions = questions;
    if (solverLanguages.length > 0) {
      filteredQuestions = questions.filter((q: any) =>
        solverLanguages.includes(q.locale || 'tr')
      );
    }

    // Get current question (index = current_q - 1)
    const questionIndex = session.current_q - 1;
    if (questionIndex >= filteredQuestions.length) throw Errors.SERVER_ERROR();

    const q = filteredQuestions[questionIndex];

    // Build answers and shuffle
    const answers = [
      { index: 1, text: q.answer_1 as string },
      { index: 2, text: q.answer_2 as string },
      { index: 3, text: q.answer_3 as string },
      { index: 4, text: q.answer_4 as string },
    ];
    const shuffledAnswers = shuffleArray(answers);

    return {
      session_id: sessionId,
      question_number: session.current_q,
      total_questions: session.total_questions,
      question_id: q.id as string,
      question_text: q.question_text as string,
      answers: shuffledAnswers,
      has_hint: q.hint_text != null && (q.hint_text as string).length > 0,
      time_limit_seconds: (q as any).time_limit ?? 30,
    };
  }

  // ─── Answer Question ──────────────────────────────────────────
  async answerQuestion(
    sessionId: string,
    solverId: string,
    selectedAnswer: number | undefined,
    powerUsed?: PowerName,
    timeSpent?: number,
  ) {
    const session = await this.getActiveSession(sessionId, solverId);

    // Get current question WITH correct_answer
    const { data: allQuestions, error: qErr } = await supabase
      .from("questions")
      .select("id, order_num, question_text, correct_answer, answer_1, answer_2, answer_3, answer_4, hint_text, stats_correct, stats_wrong, locale")
      .eq("user_id", session.target_id)
      .order("order_num", { ascending: true });

    if (qErr || !allQuestions || allQuestions.length === 0) throw Errors.SERVER_ERROR();

    // Filter by solver's languages
    const solverLanguages = await userLanguageService.getUserLanguages(solverId);
    let questions = allQuestions;
    if (solverLanguages.length > 0) {
      questions = allQuestions.filter((q: any) =>
        solverLanguages.includes(q.locale || 'tr')
      );
    }

    const questionIndex = session.current_q - 1;
    const currentQuestion = questions[questionIndex] as unknown as QuestionRow;

    // Check not already answered for this question
    const { data: existingAnswer, error: ansErr } = await supabase
      .from("quiz_answers")
      .select("id")
      .eq("session_id", sessionId)
      .eq("question_id", currentQuestion.id)
      .maybeSingle();

    if (ansErr) throw Errors.SERVER_ERROR();
    if (existingAnswer) throw Errors.ALREADY_ANSWERED();

    // ─── Power handling ───
    if (powerUsed) {
      // Get power from powers table
      const { data: power, error: powerErr } = await supabase
        .from("powers")
        .select("id, name, base_cost, is_active, accuracy_rate")
        .eq("name", powerUsed)
        .eq("is_active", true)
        .maybeSingle();

      if (powerErr || !power) throw Errors.SERVER_ERROR();

      const powerData = power as unknown as PowerRow;

      // Envanter kontrolü — hak varsa envanterden düş, yoksa anlık ödeme
      const usedFromInventory = await exchangeService.tryUseInventory(solverId, powerUsed);

      if (!usedFromInventory) {
        const cost = calculatePowerCost(powerData.base_cost, session.total_questions);
        const greenReward = calculateGreenReward(cost);

        // Spend purple diamonds from solver
        await diamondService.spendPurple(solverId, cost, `POWER_USED:${powerUsed}`, sessionId);
        // Earn green diamonds for target
        await diamondService.earnGreen(session.target_id, greenReward, `POWER_REWARD:${powerUsed}`, sessionId);

        // Track green earned on the question
        const { data: currentQData } = await supabase
          .from('questions')
          .select('stats_green_earned')
          .eq('id', currentQuestion.id)
          .single();

        if (currentQData) {
          await supabase
            .from('questions')
            .update({ stats_green_earned: currentQData.stats_green_earned + greenReward })
            .eq('id', currentQuestion.id);
        }
      }

      // ─── Power effects ───
      switch (powerUsed) {
        case "SKIP": {
          // Mark correct, record answer, proceed — no selected_answer for SKIP
          await this.recordAnswer(sessionId, currentQuestion.id, currentQuestion.correct_answer, true, powerUsed, timeSpent ?? null);
          await this.updateQuestionStats(currentQuestion.id, true, powerUsed ?? null, timeSpent ?? null, currentQuestion.correct_answer);

          if (session.current_q >= session.total_questions) {
            return await this.completeSession(session);
          }

          await this.incrementCurrentQ(sessionId, session.current_q);
          return { is_correct: true, next_question: session.current_q + 1, session_status: "IN_PROGRESS" };
        }

        case "SKIP_ALL": {
          // Mark ALL remaining questions correct
          for (let i = questionIndex; i < questions.length; i++) {
            const q = questions[i] as unknown as QuestionRow;

            // Check if already answered
            const { data: alreadyDone } = await supabase
              .from("quiz_answers")
              .select("id")
              .eq("session_id", sessionId)
              .eq("question_id", q.id)
              .maybeSingle();

            if (!alreadyDone) {
              await this.recordAnswer(sessionId, q.id, q.correct_answer, true, powerUsed, null);
              await this.updateQuestionStats(q.id, true, powerUsed ?? null, null, q.correct_answer);
            }
          }

          return await this.completeSession(session);
        }

        case "ORACLE": {
          const accuracyRate = (powerData as unknown as { accuracy_rate?: number }).accuracy_rate ?? 0.7;
          const isAccurate = Math.random() < accuracyRate;

          let suggestedIndex: number;
          if (isAccurate) {
            suggestedIndex = currentQuestion.correct_answer;
          } else {
            const wrongIndices = [1, 2, 3, 4].filter((i) => i !== currentQuestion.correct_answer);
            suggestedIndex = wrongIndices[Math.floor(Math.random() * wrongIndices.length)];
          }

          return {
            power_result: { suggested_answer_index: suggestedIndex, is_guaranteed: false },
            awaiting_answer: true,
          };
        }

        case "HALF": {
          // Pick 2 wrong answers randomly
          const wrongIndices = [1, 2, 3, 4].filter((i) => i !== currentQuestion.correct_answer);
          const shuffledWrong = shuffleArray(wrongIndices);
          const removedIndices = shuffledWrong.slice(0, 2);

          return {
            power_result: { removed_indices: removedIndices },
            awaiting_answer: true,
          };
        }

        case "TIME_EXTEND": {
          return {
            power_result: { extra_seconds: 15 },
            awaiting_answer: true,
          };
        }

        case "HINT": {
          const hintText = currentQuestion.hint_text ?? "";
          if (!hintText) {
            return {
              power_result: { hint_text: "", no_hint: true },
              awaiting_answer: true,
            };
          }
          return {
            power_result: { hint_text: hintText },
            awaiting_answer: true,
          };
        }
      }
    }

    // ─── Normal answer (no power) ───
    if (selectedAnswer == null) {
      throw Errors.VALIDATION_ERROR({ selected_answer: "Required when no power is used" });
    }
    const isCorrect = selectedAnswer === currentQuestion.correct_answer;

    // Record answer
    await this.recordAnswer(sessionId, currentQuestion.id, selectedAnswer, isCorrect, powerUsed ?? null, timeSpent ?? null);
    // Update question stats
    await this.updateQuestionStats(currentQuestion.id, isCorrect, powerUsed ?? null, timeSpent ?? null, selectedAnswer);

    if (!isCorrect) {
      // Session'ı hemen FAILED yapma — client'a SKIP kurtulma şansı ver
      return {
        is_correct: false,
        session_status: "IN_PROGRESS",
        can_rescue: true,
      };
    }

    // Correct AND last question
    if (session.current_q >= session.total_questions) {
      return await this.completeSession(session);
    }

    // Correct AND more questions
    await this.incrementCurrentQ(sessionId, session.current_q);
    return { is_correct: true, next_question: session.current_q + 1, session_status: "IN_PROGRESS" };
  }

  // ─── Get Session Result ────────────────────────────────────────
  async getSessionResult(sessionId: string, solverId: string) {
    const { data: session, error: sessErr } = await supabase
      .from("quiz_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("solver_id", solverId)
      .maybeSingle();

    if (sessErr || !session) throw Errors.SESSION_NOT_FOUND();

    const { data: answers, error: ansErr } = await supabase
      .from("quiz_answers")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (ansErr) throw Errors.SERVER_ERROR();

    return {
      session_id: session.id,
      solver_id: session.solver_id,
      target_id: session.target_id,
      status: session.status,
      current_q: session.current_q,
      total_questions: session.total_questions,
      expires_at: session.expires_at,
      completed_at: session.completed_at,
      answers: answers ?? [],
    };
  }

  // ─── Private helpers ───────────────────────────────────────────

  private async getActiveSession(sessionId: string, solverId: string): Promise<SessionRow> {
    const { data: session, error } = await supabase
      .from("quiz_sessions")
      .select("id, solver_id, target_id, status, current_q, total_questions, expires_at, completed_at")
      .eq("id", sessionId)
      .eq("solver_id", solverId)
      .maybeSingle();

    if (error || !session) throw Errors.SESSION_NOT_FOUND();

    const s = session as unknown as SessionRow;

    if (s.status !== "IN_PROGRESS") throw Errors.SESSION_NOT_FOUND();

    // Check expiry
    if (new Date(s.expires_at) < new Date()) {
      await supabase
        .from("quiz_sessions")
        .update({ status: "FAILED", completed_at: new Date().toISOString() })
        .eq("id", sessionId);

      throw Errors.TIME_UP();
    }

    return s;
  }

  private async createMatch(sessionId: string, solverId: string, targetId: string) {
    // Order user IDs for unique constraint
    const [user1, user2] = [solverId, targetId].sort();

    const { data: matchData, error: matchErr } = await supabase
      .from("matches")
      .insert({
        user1_id: user1,
        user2_id: user2,
        is_active: true,
        matched_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (matchErr && matchErr.code !== "23505") {
      console.error("[quiz] Match insert error:", matchErr);
    }

    console.log("[quiz] Match created:", { matchId: matchData?.id, user1, user2, sessionId });

    // Update session
    await supabase
      .from("quiz_sessions")
      .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
      .eq("id", sessionId);

    // Calculate badge for the solver's performance
    const badge = await this.calculateBadge(sessionId);

    // Send push to both users (target gets badge info)
    const badgeParams: Record<string, string> = badge !== "none" ? { badge } : {};
    await Promise.all([
      NotificationService.sendPush(solverId, "new_match_solver"),
      NotificationService.sendPush(targetId, "new_match", badgeParams),
    ]);
  }

  private async calculateBadge(sessionId: string): Promise<string> {
    // Get session info
    const { data: session } = await supabase
      .from("quiz_sessions")
      .select("total_time_spent, total_questions")
      .eq("id", sessionId)
      .single();

    if (!session) return "none";

    // Get answers for this session
    const { data: answers } = await supabase
      .from("quiz_answers")
      .select("is_correct, power_used, time_spent")
      .eq("session_id", sessionId);

    if (!answers || answers.length === 0) return "none";

    const totalCorrect = answers.filter((a: any) => a.is_correct).length;
    const totalQuestions = answers.length;
    const totalPowers = answers.filter((a: any) => a.power_used).length;
    const totalTimeSpent = session.total_time_spent ?? answers.reduce((s: number, a: any) => s + (a.time_spent ?? 0), 0);

    if (totalCorrect === totalQuestions && totalPowers === 0) {
      return "flawless";
    } else if (totalTimeSpent < totalQuestions * 15) {
      return "speed_solver";
    } else if (totalPowers >= 3) {
      return "power_master";
    } else if (totalCorrect === totalQuestions) {
      return "determined";
    }

    return "none";
  }

  private async completeSession(session: SessionRow) {
    await this.createMatch(session.id, session.solver_id, session.target_id);
    await this.saveSessionSummary(session.id);



    const badge = await this.calculateBadge(session.id);
    return { is_correct: true, matched: true, session_status: "COMPLETED", badge };
  }

  private async recordAnswer(
    sessionId: string,
    questionId: string,
    selectedAnswer: number,
    isCorrect: boolean,
    powerUsed: string | null,
    timeSpent: number | null = null,
  ) {
    const { error } = await supabase.from("quiz_answers").insert({
      session_id: sessionId,
      question_id: questionId,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
      power_used: powerUsed ?? null,
      time_spent: timeSpent ?? null,
    });

    if (error) throw Errors.SERVER_ERROR();
  }

  private async updateQuestionStats(
    questionId: string,
    isCorrect: boolean,
    powerUsed: string | null,
    timeSpent: number | null,
    selectedAnswer: number,
  ) {
    const { data: question } = await supabase
      .from('questions')
      .select('stats_correct, stats_wrong, stats_solve_count, stats_total_time_spent, stats_copy_used, stats_half_used, stats_hint_used, stats_time_extend_used, stats_skip_used, stats_answer_1_count, stats_answer_2_count, stats_answer_3_count, stats_answer_4_count')
      .eq('id', questionId)
      .single();

    if (!question) return;

    const updatePayload: Record<string, number> = {
      stats_solve_count: question.stats_solve_count + 1,
      [isCorrect ? 'stats_correct' : 'stats_wrong']:
        (isCorrect ? question.stats_correct : question.stats_wrong) + 1,
    };

    if (timeSpent != null) {
      updatePayload.stats_total_time_spent = question.stats_total_time_spent + timeSpent;
    }

    if (powerUsed) {
      const powerStatMap: Record<string, string> = {
        COPY: 'stats_copy_used',
        HALF: 'stats_half_used',
        HINT: 'stats_hint_used',
        TIME_EXTEND: 'stats_time_extend_used',
        SKIP: 'stats_skip_used',
        SKIP_ALL: 'stats_skip_used',
      };
      const field = powerStatMap[powerUsed];
      if (field) {
        updatePayload[field] = ((question as any)[field] ?? 0) + 1;
      }
    }

    if (selectedAnswer >= 1 && selectedAnswer <= 4) {
      const answerField = `stats_answer_${selectedAnswer}_count`;
      updatePayload[answerField] = ((question as any)[answerField] ?? 0) + 1;
    }

    await supabase
      .from('questions')
      .update(updatePayload)
      .eq('id', questionId);
  }

  private async saveSessionSummary(sessionId: string) {
    const { data: sessionAnswers } = await supabase
      .from('quiz_answers')
      .select('power_used, time_spent')
      .eq('session_id', sessionId);

    const totalTime = (sessionAnswers ?? []).reduce((s: number, a: any) => s + (a.time_spent ?? 0), 0);
    const powersUsedMap: Record<string, number> = {};
    for (const a of sessionAnswers ?? []) {
      if (a.power_used) {
        powersUsedMap[a.power_used] = (powersUsedMap[a.power_used] ?? 0) + 1;
      }
    }

    await supabase.from('quiz_sessions').update({
      total_time_spent: totalTime,
      powers_used: powersUsedMap,
    }).eq('id', sessionId);
  }

  private async incrementCurrentQ(sessionId: string, currentQ: number) {
    const { error } = await supabase
      .from("quiz_sessions")
      .update({ current_q: currentQ + 1 })
      .eq("id", sessionId);

    if (error) throw Errors.SERVER_ERROR();
  }
  // ─── Rescue with SKIP or SKIP_ALL (after wrong answer) ──────
  async rescueWithSkip(sessionId: string, solverId: string, powerType: "SKIP" | "SKIP_ALL" = "SKIP") {
    const session = await this.getActiveSession(sessionId, solverId);

    // Son yanlış cevabı bul
    const { data: lastAnswer, error: ansErr } = await supabase
      .from("quiz_answers")
      .select("id, question_id, is_correct")
      .eq("session_id", sessionId)
      .eq("is_correct", false)
      .limit(1)
      .maybeSingle();

    if (ansErr || !lastAnswer) {
      throw Errors.VALIDATION_ERROR({ rescue: "No wrong answer to rescue" });
    }

    // Power envanter/elmas kontrolü
    const { data: power, error: powerErr } = await supabase
      .from("powers")
      .select("id, name, base_cost, is_active")
      .eq("name", powerType)
      .eq("is_active", true)
      .maybeSingle();

    if (powerErr || !power) throw Errors.SERVER_ERROR();

    const usedFromInventory = await exchangeService.tryUseInventory(solverId, powerType);

    if (!usedFromInventory) {
      const cost = calculatePowerCost(power.base_cost, session.total_questions);
      const greenReward = calculateGreenReward(cost);

      await diamondService.spendPurple(solverId, cost, `POWER_USED:${powerType}_RESCUE`, sessionId);
      await diamondService.earnGreen(session.target_id, greenReward, `POWER_REWARD:${powerType}_RESCUE`, sessionId);
    }

    // Yanlış cevabı override et
    await supabase
      .from("quiz_answers")
      .update({ is_correct: true, power_used: powerType })
      .eq("id", lastAnswer.id);

    // Soru stats güncelle
    const { data: qStats } = await supabase
      .from("questions")
      .select("stats_correct, stats_wrong, stats_skip_used")
      .eq("id", lastAnswer.question_id)
      .single();

    if (qStats) {
      await supabase
        .from("questions")
        .update({
          stats_correct: qStats.stats_correct + 1,
          stats_wrong: Math.max(0, qStats.stats_wrong - 1),
          stats_skip_used: (qStats.stats_skip_used ?? 0) + 1,
        })
        .eq("id", lastAnswer.question_id);
    }

    // SKIP_ALL → kalan tüm soruları da geç
    if (powerType === "SKIP_ALL") {
      const { data: allQuestions } = await supabase
        .from("questions")
        .select("id, order_num, correct_answer, locale")
        .eq("user_id", session.target_id)
        .order("order_num", { ascending: true });

      if (allQuestions) {
        const solverLanguages = await userLanguageService.getUserLanguages(solverId);
        let questions = allQuestions;
        if (solverLanguages.length > 0) {
          questions = allQuestions.filter((q: any) =>
            solverLanguages.includes(q.locale || 'tr')
          );
        }

        // Mevcut sorudan sonraki soruları işaretle
        for (let i = session.current_q; i < questions.length; i++) {
          const q = questions[i] as any;

          const { data: alreadyDone } = await supabase
            .from("quiz_answers")
            .select("id")
            .eq("session_id", sessionId)
            .eq("question_id", q.id)
            .maybeSingle();

          if (!alreadyDone) {
            await this.recordAnswer(sessionId, q.id, q.correct_answer, true, "SKIP_ALL", null);
          }
        }
      }

      return await this.completeSession(session);
    }

    // SKIP → son soru muydu?
    if (session.current_q >= session.total_questions) {
      return await this.completeSession(session);
    }

    await this.incrementCurrentQ(sessionId, session.current_q);
    return { is_correct: true, next_question: session.current_q + 1, session_status: "IN_PROGRESS" };
  }

  // ─── Fail Session (user declined rescue) ────────────────────
  async failSession(sessionId: string, solverId: string) {
    const session = await this.getActiveSession(sessionId, solverId);

    await supabase
      .from("quiz_sessions")
      .update({ status: "FAILED", completed_at: new Date().toISOString() })
      .eq("id", sessionId);

    await this.saveSessionSummary(sessionId);

    return { session_status: "FAILED" };
  }

  // ─── Match Quiz Summary (for chat card) ──────────────────────
  async getMatchQuizSummary(matchId: string, userId: string) {
    // Find the match
    const { data: match } = await supabase
      .from('matches')
      .select('id, user1_id, user2_id')
      .eq('id', matchId)
      .single();

    if (!match) throw Errors.SESSION_NOT_FOUND();

    // Verify user is part of this match
    if (match.user1_id !== userId && match.user2_id !== userId) {
      throw Errors.SESSION_NOT_FOUND();
    }

    // Find COMPLETED quiz session for this match (either direction)
    const { data: session } = await supabase
      .from('quiz_sessions')
      .select('id, solver_id, target_id, status, total_time_spent, powers_used, started_at, completed_at')
      .or(
        `and(solver_id.eq.${match.user1_id},target_id.eq.${match.user2_id}),and(solver_id.eq.${match.user2_id},target_id.eq.${match.user1_id})`
      )
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) return null;

    // Get answers
    const { data: answers } = await supabase
      .from('quiz_answers')
      .select('is_correct, power_used, time_spent')
      .eq('session_id', session.id);

    const totalCorrect = (answers ?? []).filter((a: any) => a.is_correct).length;
    const totalQuestions = answers?.length ?? 0;
    const totalPowers = (answers ?? []).filter((a: any) => a.power_used).length;

    // Performance badge
    let performanceBadge = 'none';
    if (totalCorrect === totalQuestions && totalPowers === 0) {
      performanceBadge = 'flawless';
    } else if (session.total_time_spent && session.total_time_spent < totalQuestions * 15) {
      performanceBadge = 'speed_solver';
    } else if (totalPowers >= 3) {
      performanceBadge = 'power_master';
    } else if (totalCorrect === totalQuestions) {
      performanceBadge = 'determined';
    }

    return {
      session_id: session.id,
      solver_id: session.solver_id,
      total_questions: totalQuestions,
      total_correct: totalCorrect,
      total_time_spent: session.total_time_spent,
      powers_used: session.powers_used,
      total_powers_used: totalPowers,
      performance_badge: performanceBadge,
      completed_at: session.completed_at,
    };
  }
}

export const quizService = new QuizService();
