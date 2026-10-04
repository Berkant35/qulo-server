import { supabase } from "../config/supabase.js";
import { resolveLocale } from '../utils/locales.js';
import { questionLocale } from "../constants/locales.js";
import { AppError, Errors } from "../utils/errors.js";
import { calculatePowerCost, calculateGreenReward, shuffleArray, pickOracleSuggestion, powerReward } from "../utils/math.js";
import { diamondService } from "./diamond.service.js";
import { exchangeService } from "./exchange.service.js";
import { economyConfigService } from "./economy-config.service.js";
import { NotificationService } from "./notification.service.js";
import { matchEmailService } from "./match-email.service.js";
import { userLanguageService } from "./user-language.service.js";
import type { PowerName } from "../types/index.js";

/** questions.answer_1..answer_4 — cevap indeksleri 1 tabanli. */
const QUIZ_ANSWER_INDICES: readonly number[] = [1, 2, 3, 4];

/** `questions.time_limit` bos ise (eski satirlar). */
const DEFAULT_QUESTION_SECONDS = 30;
/** Sure bilinemezse (eski oturum / okuma hatasi) — `question.validator` ust siniri; sunum anı daraltir. */
const MAX_QUESTION_SECONDS = 300;

/**
 * `current_q_powers`'a yazilan ic isaret: paywall ek suresi soru basina BIR KEZ verilir.
 * Atomiklik guc isaretlemesiyle ayni RPC'den (037); soru gecisinde dizi sifirlaninca hak yenilenir.
 * Istemciye `used_powers` icinde DONMEZ.
 */
const PAYWALL_GRACE_MARKER = "__PAYWALL_GRACE";

const secondsFromNow = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

const remainingSeconds = (expiresAt: string): number =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

/** Istemciye donen kullanilmis gucler — ic isaretler haric. */
const visiblePowers = (powers: string[] | null): string[] =>
  (powers ?? []).filter((p) => p !== PAYWALL_GRACE_MARKER);

interface SessionRow {
  id: string;
  solver_id: string;
  target_id: string;
  status: string;
  started_at?: string;
  current_q: number;
  total_questions: number;
  expires_at: string;
  completed_at: string | null;
  question_ids: string[] | null;
  current_q_powers: string[] | null;
  /** Su anki soruda HALF'in eledigi indeksler; `current_q_powers` ile birlikte sifirlanir. */
  current_q_eliminated: number[] | null;
  /** Su anki soruda ORACLE'in onerdigi indeks; HALF bunu elemez. Soru gecisinde sifirlanir. */
  current_q_oracle: number | null;
}

/** Oturuma ozel efektif guc fiyatlari — soru sayisi carpani uygulanmis hali. */
export interface SessionPowerCost {
  purple: number;
  green: number;
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
  locale?: string;
}

interface PowerRow {
  id: string;
  name: string;
  base_cost: number;
  is_active: boolean;
}

export class QuizService {
  /**
   * Filter questions to only those matching solver's preferred languages.
   * If solverLanguages is empty, returns all questions (no filtering).
   */
  private filterByLanguagePreference(questions: any[], solverLanguages: string[]): any[] {
    if (!solverLanguages.length) return questions;
    return questions.filter((q: any) => solverLanguages.includes(questionLocale(q.locale)));
  }

  /**
   * Oturumun efektif guc fiyatlari — TEK DOGRU KAYNAK.
   *
   * Hem ucretlendirme (answerQuestion, rescueWithSkip) hem de client'a gonderilen
   * fiyat listesi buradan uretilir. Daha once client carpani hic uygulamiyordu
   * (2 soruluk quizde 2x yuksek gosteriyordu) ve rescue `powers.base_cost`, normal
   * kullanim `config.powerCosts` okuyordu — iki ayri drift kaynagi kapatildi.
   */
  private async sessionPowerCosts(totalQuestions: number): Promise<Record<string, SessionPowerCost>> {
    return (await this.sessionPowerPricing(totalQuestions)).costs;
  }

  /**
   * Fiyat listesi + ödül bölme oranı TEK config okumasından: ücretlendirme ve ödül aynı config
   * sürümünü görür (eskiden oran ikinci kez okunuyordu — arada sürüm değişirse ayrışabilirdi).
   */
  private async sessionPowerPricing(
    totalQuestions: number,
  ): Promise<{ costs: Record<string, SessionPowerCost>; ratio: number }> {
    const config = await economyConfigService.getConfig();
    const multipliers = config.core.questionCountMultipliers;
    const ratio = config.core.greenDiamondRewardRatio;

    const costs: Record<string, SessionPowerCost> = {};
    for (const [name, entry] of Object.entries(config.powerCosts)) {
      const purple = calculatePowerCost(entry.purpleCost, totalQuestions, multipliers);
      costs[name] = { purple, green: calculateGreenReward(purple, ratio) };
    }
    return { costs, ratio };
  }

  /**
   * Gucu su anki soruya ATOMIK olarak isaretle — ucretlendirmeden ONCE.
   *
   * Envanter kapisi kalkinca (guc butonlari artik dogrudan elmastan dusuyor) ayni
   * guce tekrar basmak tekrar ucret aliyordu; hicbir katmanda kayit yoktu.
   *
   * Once-oku-sonra-yaz YETMEZ: iki es zamanli istek ikisi de bos gorup ikisi de
   * ucret alabilir. `.not(..., "cs", ...)` (contains) kosulu ayni gucun ikinci kez
   * eklenmesini veritabani seviyesinde imkansiz kilar — guncellenen satir donmezse
   * yarisi kaybettik demektir.
   *
   * Isaretleme ucretten ONCE yapilir; ucret basarisiz olursa `unmarkPowerUsed` ile
   * geri alinir. Boylece en kotu senaryo "ucret alindi ama isaretlenmedi" degil,
   * "isaretlendi ama ucret alinmadi" olur — kullanici parasini kaybetmez.
   */
  private async markPowerUsed(session: SessionRow, powerUsed: string) {
    const { data, error } = await supabase.rpc("quiz_session_mark_power", {
      p_session_id: session.id,
      p_power: powerUsed,
    });

    if (error) {
      console.error("[quiz] markPowerUsed error:", error);
      throw Errors.SERVER_ERROR();
    }
    if (data !== true) throw Errors.POWER_ALREADY_USED(powerUsed);
  }

  /**
   * Ucretlendirme basarisiz oldu — isareti geri al ki kullanici tekrar deneyebilsin.
   *
   * Istek basindaki snapshot'la DEGIL, taze okumayla yazar: aradan gecen es zamanli
   * bir istek baska bir gucu isaretlemis olabilir, snapshot'la yazmak onu silerdi.
   */
  private async unmarkPowerUsed(session: SessionRow, powerUsed: string) {
    const { error } = await supabase.rpc("quiz_session_unmark_power", {
      p_session_id: session.id,
      p_power: powerUsed,
    });

    if (error) {
      console.error("[quiz] unmarkPowerUsed failed:", error, { sessionId: session.id, powerUsed });
    }
  }

  /**
   * Cozucunun dil listesi: users.preferred_languages (054 sonrasi tek kaynak); eski
   * satirlar icin user_languages, o da bossa uygulama dili (matching 5.6 ile ayni kural —
   * bos liste filtreyi kapatip okunamayan sorular gosterirdi).
   */
  private async resolveSolverLanguages(solverId: string): Promise<string[]> {
    const { data: userData } = await supabase
      .from('users')
      .select('preferred_languages, locale')
      .eq('id', solverId)
      .single();

    const prefLangs = userData?.preferred_languages as string[] | null;
    if (prefLangs && prefLangs.length > 0) return prefLangs;

    const fromTable = await userLanguageService.getUserLanguages(solverId);
    return fromTable.length > 0 ? fromTable : [resolveLocale(userData?.locale as string | null)];
  }

  // ─── Start Session ─────────────────────────────────────────────
  async startSession(solverId: string, targetId: string) {
    // 0. Defensive checks — fail fast on invalid pairs.
    if (solverId === targetId) throw Errors.SELF_SWIPE();

    const { data: target, error: targetErr } = await supabase
      .from("users")
      .select("id")
      .eq("id", targetId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (targetErr) throw Errors.SERVER_ERROR();
    if (!target) throw Errors.USER_NOT_FOUND();

    // 1. Fetch target's questions with locale
    const { data: allQuestions, error: qErr } = await supabase
      .from("questions")
      .select("id, time_limit, locale")
      .eq("user_id", targetId)
      .order("order_num", { ascending: true });

    if (qErr) throw Errors.SERVER_ERROR();
    if (!allQuestions || allQuestions.length < 2) throw Errors.NO_QUESTIONS();

    // Sort questions by solver's language preference (preferred first, others after)
    const solverLanguages = await this.resolveSolverLanguages(solverId);
    const filteredQuestions = this.filterByLanguagePreference(allQuestions, solverLanguages);

    // Language filter can return <2 if solver changed prefs after discover loaded.
    // Treat as NO_QUESTIONS instead of creating an empty session that immediately fails.
    if (filteredQuestions.length < 2) throw Errors.NO_QUESTIONS();

    const totalQuestions = filteredQuestions.length;

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
      // Check if existing session is expired — if so, mark as failed and create new one
      const { data: existSession } = await supabase
        .from("quiz_sessions")
        .select("expires_at")
        .eq("id", existing.id)
        .single();

      if (existSession && new Date(existSession.expires_at) < new Date()) {
        await supabase
          .from("quiz_sessions")
          .update({ status: "FAILED", completed_at: new Date().toISOString() })
          .eq("id", existing.id);
        // Fall through to create new session
      } else {
        return {
          session_id: existing.id as string,
          total_questions: totalQuestions,
          power_costs: await this.sessionPowerCosts(totalQuestions),
        };
      }
    }

    // 3. Create session — SORU BASINA sure (2026-10-04). Eski kural "tum sorularin toplami + 10 sn"
    // paywall, guc sayfasi ve soru gecis animasyonu sirasinda da isliyordu: istemci sayaci dururken
    // sunucu suresi bitiyor, kullanici TIME_UP aliyordu. Simdi `expires_at` yalniz o anki sorunun
    // son anini tutar: burada ilk soru + gecis tamponu, soru sunulunca (getCurrentQuestion)
    // "sure + tolerans"a daralir. Ayrinti: `armQuestionDeadline`.
    const { timing } = await economyConfigService.getConfig();
    const firstLimit = (filteredQuestions[0] as any).time_limit ?? DEFAULT_QUESTION_SECONDS;
    const expiresAt = secondsFromNow(firstLimit + timing.questionToleranceSeconds + timing.transitionGraceSeconds);

    const questionIds = filteredQuestions.map((q: any) => q.id as string);

    const { data: session, error: createErr } = await supabase
      .from("quiz_sessions")
      .insert({
        solver_id: solverId,
        target_id: targetId,
        status: "IN_PROGRESS",
        current_q: 1,
        total_questions: totalQuestions,
        expires_at: expiresAt,
        question_ids: questionIds,
      })
      .select("id")
      .single();

    if (createErr || !session) throw Errors.SERVER_ERROR();

    return {
      session_id: session.id as string,
      total_questions: totalQuestions,
      power_costs: await this.sessionPowerCosts(totalQuestions),
    };
  }

  // ─── Get Current Question ──────────────────────────────────────
  async getCurrentQuestion(sessionId: string, solverId: string) {
    const session = await this.getActiveSession(sessionId, solverId);
    const questionIndex = session.current_q - 1;

    let questionId: string;
    if (session.question_ids && session.question_ids.length > 0) {
      if (questionIndex >= session.question_ids.length) throw Errors.SERVER_ERROR();
      questionId = session.question_ids[questionIndex];
    } else {
      // Legacy fallback for sessions created before migration
      const { data: allQ } = await supabase
        .from("questions")
        .select("id, locale")
        .eq("user_id", session.target_id)
        .order("order_num", { ascending: true });
      const solverLanguages = await this.resolveSolverLanguages(solverId);
      const ordered = this.filterByLanguagePreference(allQ || [], solverLanguages);
      if (questionIndex >= ordered.length) throw Errors.SERVER_ERROR();
      questionId = ordered[questionIndex].id as string;
    }

    const { data: q, error: qErr } = await supabase
      .from("questions")
      .select("id, order_num, question_text, answer_1, answer_2, answer_3, answer_4, hint_text, time_limit, locale")
      .eq("id", questionId)
      .single();

    if (qErr || !q) throw Errors.SERVER_ERROR();

    const answers = [
      { index: 1, text: q.answer_1 as string },
      { index: 2, text: q.answer_2 as string },
      { index: 3, text: q.answer_3 as string },
      { index: 4, text: q.answer_4 as string },
    ];
    const shuffledAnswers = shuffleArray(answers);
    const timeLimit = ((q as any).time_limit as number | null) ?? DEFAULT_QUESTION_SECONDS;
    const expiresAt = await this.armQuestionDeadline(session, timeLimit);

    return {
      session_id: sessionId,
      question_number: session.current_q,
      total_questions: session.total_questions,
      question_id: q.id as string,
      question_text: q.question_text as string,
      answers: shuffledAnswers,
      has_hint: q.hint_text != null && (q.hint_text as string).length > 0,
      time_limit_seconds: timeLimit,
      // Sunucunun bu soru icin son ani (2026-10-04+). Yeni istemci sayaci `remaining_seconds` ile
      // baslatir (uygulama yeniden acilinca tam sure degil kalan sure); eski istemci yok sayar.
      expires_at: expiresAt,
      remaining_seconds: remainingSeconds(expiresAt),
      // Uygulama yeniden baslatilsa da kullanilmis gucler dogru gorunsun.
      used_powers: visiblePowers(session.current_q_powers),
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
    const questionIndex = session.current_q - 1;

    let currentQuestion: QuestionRow;
    if (session.question_ids && session.question_ids.length > 0) {
      if (questionIndex >= session.question_ids.length) throw Errors.SERVER_ERROR();
      const qId = session.question_ids[questionIndex];
      const { data: qData, error: qErr } = await supabase
        .from("questions")
        .select("id, order_num, question_text, correct_answer, answer_1, answer_2, answer_3, answer_4, hint_text, stats_correct, stats_wrong, locale")
        .eq("id", qId)
        .single();
      if (qErr || !qData) throw Errors.SERVER_ERROR();
      currentQuestion = qData as unknown as QuestionRow;
    } else {
      const { data: allQuestions, error: qErr } = await supabase
        .from("questions")
        .select("id, order_num, question_text, correct_answer, answer_1, answer_2, answer_3, answer_4, hint_text, stats_correct, stats_wrong, locale")
        .eq("user_id", session.target_id)
        .order("order_num", { ascending: true });
      if (qErr || !allQuestions || allQuestions.length === 0) throw Errors.SERVER_ERROR();
      const solverLanguages = await this.resolveSolverLanguages(solverId);
      const questions = this.filterByLanguagePreference(allQuestions, solverLanguages);
      currentQuestion = questions[questionIndex] as unknown as QuestionRow;
    }

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

      // ATOMIK isaretleme — ucretlendirmeden ONCE. Ikinci kez basilirsa burada
      // POWER_ALREADY_USED firlar ve hicbir elmas harcanmaz.
      await this.markPowerUsed(session, powerUsed);

      try {
        // Envanter kontrolü — hak varsa envanterden düş, yoksa anlık ödeme
        const usedFromInventory = await exchangeService.tryUseInventory(solverId, powerUsed);

        if (!usedFromInventory) {
          const { costs, ratio } = await this.sessionPowerPricing(session.total_questions);
          const cost = costs[powerUsed].purple;

          // Önce ödenmiş mor düşer; ödenmiş payı hedefte RAINBOW olur (spec 2026-09-27).
          const { paidUsed } = await diamondService.spendPurple(solverId, cost, `POWER_USED:${powerUsed}`, sessionId);
          const reward = powerReward(cost, paidUsed, ratio);
          await diamondService.creditReward(session.target_id, reward, `POWER_REWARD:${powerUsed}`, sessionId);

          // Soru istatistiği yalnız yeşil payı sayar (rainbow ayrı elmas).
          const { data: currentQData } = await supabase
            .from('questions')
            .select('stats_green_earned')
            .eq('id', currentQuestion.id)
            .single();

          if (currentQData) {
            await supabase
              .from('questions')
              .update({ stats_green_earned: currentQData.stats_green_earned + reward.green })
              .eq('id', currentQuestion.id);
          }
        }
      } catch (err) {
        // Odeme basarisiz (ornegin INSUFFICIENT_DIAMONDS) — isareti geri al ki
        // kullanici elmas aldiktan sonra ayni gucu tekrar deneyebilsin.
        await this.unmarkPowerUsed(session, powerUsed);
        await this.grantPaywallGrace(session, err);
        throw err;
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

          await this.incrementCurrentQ(session);
          return { is_correct: true, next_question: session.current_q + 1, session_status: "IN_PROGRESS" };
        }

        case "SKIP_ALL": {
          // Mark ALL remaining questions correct
          let remainingIds: string[];
          if (session.question_ids && session.question_ids.length > 0) {
            remainingIds = session.question_ids.slice(questionIndex);
          } else {
            const { data: allQ } = await supabase
              .from("questions")
              .select("id, order_num, correct_answer, locale")
              .eq("user_id", session.target_id)
              .order("order_num", { ascending: true });
            if (!allQ) remainingIds = [];
            else {
              const langs = await this.resolveSolverLanguages(solverId);
              const filtered = this.filterByLanguagePreference(allQ, langs);
              remainingIds = filtered.slice(questionIndex).map((q: any) => q.id as string);
            }
          }

          if (remainingIds.length > 0) {
            // Batch fetch all remaining questions in a single query
            const { data: qRows } = await supabase
              .from("questions")
              .select("id, correct_answer")
              .in("id", remainingIds);

            // Batch fetch already-answered question IDs in a single query
            const { data: existingAnswers } = await supabase
              .from("quiz_answers")
              .select("question_id")
              .eq("session_id", sessionId)
              .in("question_id", remainingIds);

            const answeredSet = new Set((existingAnswers ?? []).map((a: any) => a.question_id as string));
            const toInsert = (qRows ?? [])
              .filter((q: any) => !answeredSet.has(q.id))
              .map((q: any) => ({
                session_id: sessionId,
                question_id: q.id,
                selected_answer: q.correct_answer,
                is_correct: true,
                power_used: powerUsed ?? null,
                time_spent: null,
              }));

            if (toInsert.length > 0) {
              const { error: insertErr } = await supabase.from("quiz_answers").insert(toInsert);
              if (insertErr) throw Errors.SERVER_ERROR();

              // Stats update per question (cannot be batched with Supabase client)
              for (const q of qRows ?? []) {
                if (!answeredSet.has(q.id)) {
                  await this.updateQuestionStats(q.id, true, powerUsed ?? null, null, q.correct_answer);
                }
              }
            }
          }

          return await this.completeSession(session);
        }

        case "ORACLE": {
          const accuracyRate = (powerData as unknown as { accuracy_rate?: number }).accuracy_rate ?? 0.7;
          const isAccurate = Math.random() < accuracyRate;
          // Yanlis dali HALF'in eledigi indeksleri DISLAR (pickOracleSuggestion).
          const suggestedIndex = pickOracleSuggestion(
            QUIZ_ANSWER_INDICES,
            currentQuestion.correct_answer,
            session.current_q_eliminated ?? [],
            isAccurate,
          );
          // Kalici yaz: sonraki HALF bu indeksi elemesin (ters sira sizintisi).
          await this.persistPowerOutcome(session, { current_q_oracle: suggestedIndex });

          return {
            power_result: { suggested_answer_index: suggestedIndex, is_guaranteed: false },
            awaiting_answer: true,
          };
        }

        case "HALF": {
          // 3 yanlistan 2'sini ele; ORACLE'in onerdigi indeks hayatta kalir (elenmesi
          // "ORACLE yanlisti" bilgisini bedavaya verirdi).
          const wrongIndices = QUIZ_ANSWER_INDICES.filter(
            (i) => i !== currentQuestion.correct_answer && i !== session.current_q_oracle,
          );
          const removedIndices = shuffleArray(wrongIndices).slice(0, 2);
          await this.persistPowerOutcome(session, { current_q_eliminated: removedIndices });

          return {
            power_result: { removed_indices: removedIndices },
            awaiting_answer: true,
          };
        }

        case "TIME_EXTEND": {
          // Eskiden yalniz istemci sayaci uzuyordu (sabit 15); sunucu son ani yerinde kaliyordu —
          // uzatilan surede verilen cevap TIME_UP aliyordu. Sure config'ten, iki taraf ayni degeri gorur.
          const { timing } = await economyConfigService.getConfig();
          await this.extendDeadline(session, timing.timeExtendSeconds);
          return {
            power_result: { extra_seconds: timing.timeExtendSeconds },
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
      // Session'ı hemen FAILED yapma — client'a SKIP kurtulma şansı ver. Cevap kaydedildi,
      // artik sure avantaji yok: kurtarma/vazgec karari (paywall dahil) icin pencere ac.
      await this.openRescueWindow(session);
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
    await this.incrementCurrentQ(session);
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
      .select("id, solver_id, target_id, status, started_at, current_q, total_questions, expires_at, completed_at, question_ids, current_q_powers, current_q_eliminated, current_q_oracle")
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

    if (matchErr) {
      if (matchErr.code === "23505") {
        // Duplicate — reactivate existing match
        const { data: reactivated } = await supabase
          .from("matches")
          .update({ is_active: true, matched_at: new Date().toISOString() })
          .eq("user1_id", user1)
          .eq("user2_id", user2)
          .select("id")
          .single();
        console.log("[quiz] Match reactivated:", { matchId: reactivated?.id, user1, user2, sessionId });
      } else {
        console.error("[quiz] Match insert error:", matchErr);
      }
    } else {
      console.log("[quiz] Match created:", { matchId: matchData?.id, user1, user2, sessionId });
    }

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

    // Fire-and-forget match email to owner (target had their questions solved).
    // Service handles opt-out, 24h inactive threshold, locale resolution, and swallows send errors.
    matchEmailService.sendMatchEmail(targetId).catch((err) => {
      console.error("[quiz.createMatch] match email failed", { targetId, err });
    });
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
        // Kolon adi legacy (guc "COPY" iken adlandirilmis, sonra ORACLE olmus).
        // Anahtar yanlis oldugu icin Kahin kullanimi bugune kadar hic sayilmadi.
        ORACLE: 'stats_copy_used',
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

  /**
   * Guc sonucunu (HALF elenenleri / ORACLE onerisi) oturuma yazar — ucretten SONRA.
   * `current_q` kosulu: es zamanli bir cevap `incrementCurrentQ` ile soruyu ilerlettiyse
   * bayat sonuc sonraki soruya tasinmasin. Kabul edilen risk: nadir yazma hatasinda
   * kullanici odedi, guc isaretli (tekrar alamaz), reload'da sonuc kaybolur; istek yine doner.
   */
  private async persistPowerOutcome(
    session: SessionRow,
    patch: Partial<Pick<SessionRow, "current_q_eliminated" | "current_q_oracle">>,
  ): Promise<void> {
    const { error } = await supabase
      .from("quiz_sessions")
      .update(patch)
      .eq("id", session.id)
      .eq("current_q", session.current_q);
    if (error) {
      console.error("[quiz] power outcome persist failed:", error, {
        sessionId: session.id, solverId: session.solver_id, patch,
      });
    }
  }

  /**
   * Sonraki soruya gec. Guc idempotency kaydini da sifirlar — bu, hem cevap hem
   * rescue yolunun gectigi TEK ilerletme noktasi.
   */
  private async incrementCurrentQ(session: SessionRow) {
    // Sonraki sorunun son ani: sure + tolerans + gecis tamponu (geri bildirim animasyonu + soru
    // cekme). Soru sunulunca `armQuestionDeadline` tamponu keser.
    const [{ timing }, nextLimit] = await Promise.all([
      economyConfigService.getConfig(),
      this.questionTimeLimit(session.question_ids?.[session.current_q]),
    ]);
    const { error } = await supabase
      .from("quiz_sessions")
      .update({
        current_q: session.current_q + 1,
        current_q_powers: [],
        current_q_eliminated: [],
        current_q_oracle: null,
        expires_at: secondsFromNow(nextLimit + timing.questionToleranceSeconds + timing.transitionGraceSeconds),
      })
      .eq("id", session.id);

    if (error) throw Errors.SERVER_ERROR();
  }

  /** Sorunun suresi; bilinemezse ust sinir (sunum ani daraltir — fazla cömert taraf guvenli). */
  private async questionTimeLimit(questionId: string | undefined): Promise<number> {
    if (!questionId) return MAX_QUESTION_SECONDS;
    const { data, error } = await supabase
      .from("questions")
      .select("time_limit")
      .eq("id", questionId)
      .maybeSingle();
    if (error || !data) return MAX_QUESTION_SECONDS;
    return (data.time_limit as number | null) ?? DEFAULT_QUESTION_SECONDS;
  }

  /**
   * Soru sunuldu: son ani "simdi + sure + tolerans"a DARALT (asla uzatma). Kosullu yazim
   * (`expires_at > yeni`) sayesinde ayni soruyu tekrar cekmek (yeniden acilis, cift istek) sureyi
   * sifirlamaz — sure kazanma yolu yok. TIME_EXTEND / paywall ile uzamis son an da yeni sunumda
   * kalan surenin otesine tasinmaz. Yazim hatasi akisi bozmaz (mevcut son an gecerli kalir).
   */
  private async armQuestionDeadline(session: SessionRow, timeLimit: number): Promise<string> {
    const { timing } = await economyConfigService.getConfig();
    const deadline = secondsFromNow(timeLimit + timing.questionToleranceSeconds);
    if (new Date(deadline).getTime() >= new Date(session.expires_at).getTime()) return session.expires_at;

    const { data, error } = await supabase
      .from("quiz_sessions")
      .update({ expires_at: deadline })
      .eq("id", session.id)
      .eq("current_q", session.current_q)
      .gt("expires_at", deadline)
      .select("expires_at")
      .maybeSingle();
    if (error) {
      console.error("[quiz] deadline arm failed:", error, { sessionId: session.id });
      return session.expires_at;
    }
    return (data?.expires_at as string | undefined) ?? session.expires_at;
  }

  /** Su anki sorunun son anini `seconds` kadar ileri al (TIME_EXTEND, paywall ek suresi). */
  private async extendDeadline(session: SessionRow, seconds: number): Promise<void> {
    const extended = new Date(new Date(session.expires_at).getTime() + seconds * 1000).toISOString();
    const { error } = await supabase
      .from("quiz_sessions")
      .update({ expires_at: extended })
      .eq("id", session.id)
      .eq("current_q", session.current_q);
    if (error) console.error("[quiz] deadline extend failed:", error, { sessionId: session.id, seconds });
  }

  /**
   * Yanlis cevap kaydedildi: kurtarma (SKIP/SKIP_ALL, gerekirse paywall) ya da vazgec karari icin
   * pencere. Yalniz uzatir; cevap zaten yazildigi icin ek sure avantaj saglamaz.
   */
  private async openRescueWindow(session: SessionRow): Promise<void> {
    const { timing } = await economyConfigService.getConfig();
    const deadline = secondsFromNow(timing.rescueWindowSeconds);
    const { error } = await supabase
      .from("quiz_sessions")
      .update({ expires_at: deadline })
      .eq("id", session.id)
      .eq("current_q", session.current_q)
      .lt("expires_at", deadline);
    if (error) console.error("[quiz] rescue window failed:", error, { sessionId: session.id });
  }

  /**
   * Yetersiz elmas → istemci paywall acar ve sayacini durdurur; sunucu son ani da soru basina
   * BIR KEZ `paywallGraceSeconds` uzar (isaret 037 RPC'si ile atomik — es zamanli iki istek iki kez
   * uzatamaz). Baska hatalarda hicbir sey yapmaz; kendi hatasini yutar (asil hata firlatilmaya devam eder).
   */
  private async grantPaywallGrace(session: SessionRow, cause: unknown): Promise<void> {
    if (!(cause instanceof AppError) || cause.code !== "INSUFFICIENT_DIAMONDS") return;
    try {
      const { data, error } = await supabase.rpc("quiz_session_mark_power", {
        p_session_id: session.id,
        p_power: PAYWALL_GRACE_MARKER,
      });
      if (error || data !== true) return;
      const { timing } = await economyConfigService.getConfig();
      await this.extendDeadline(session, timing.paywallGraceSeconds);
    } catch (err) {
      console.error("[quiz] paywall grace failed:", err, { sessionId: session.id });
    }
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
      // TEK DOGRU KAYNAK — eskiden burasi `powers.base_cost`, normal guc kullanimi ise
      // `config.powerCosts` okuyordu (bkz. sessionPowerCosts).
      const { costs, ratio } = await this.sessionPowerPricing(session.total_questions);
      const cost = costs[powerType].purple;

      const { paidUsed } = await diamondService.spendPurple(solverId, cost, `POWER_USED:${powerType}_RESCUE`, sessionId);
      const reward = powerReward(cost, paidUsed, ratio);
      await diamondService.creditReward(session.target_id, reward, `POWER_REWARD:${powerType}_RESCUE`, sessionId);
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
      let remainingQuestionIds: string[];

      if (session.question_ids && session.question_ids.length > 0) {
        remainingQuestionIds = session.question_ids.slice(session.current_q);
      } else {
        const { data: allQuestions } = await supabase
          .from("questions")
          .select("id, order_num, correct_answer, locale")
          .eq("user_id", session.target_id)
          .order("order_num", { ascending: true });

        if (!allQuestions) remainingQuestionIds = [];
        else {
          const solverLanguages = await this.resolveSolverLanguages(solverId);
          const questions = this.filterByLanguagePreference(allQuestions, solverLanguages);
          remainingQuestionIds = questions.slice(session.current_q).map((q: any) => q.id as string);
        }
      }

      if (remainingQuestionIds.length > 0) {
        // Batch fetch all remaining questions in a single query
        const { data: qRows } = await supabase
          .from("questions")
          .select("id, correct_answer")
          .in("id", remainingQuestionIds);

        // Batch fetch already-answered question IDs in a single query
        const { data: existingAnswers } = await supabase
          .from("quiz_answers")
          .select("question_id")
          .eq("session_id", sessionId)
          .in("question_id", remainingQuestionIds);

        const answeredSet = new Set((existingAnswers ?? []).map((a: any) => a.question_id as string));
        const toInsert = (qRows ?? [])
          .filter((q: any) => !answeredSet.has(q.id))
          .map((q: any) => ({
            session_id: sessionId,
            question_id: q.id,
            selected_answer: q.correct_answer,
            is_correct: true,
            power_used: "SKIP_ALL",
            time_spent: null,
          }));

        if (toInsert.length > 0) {
          const { error: insertErr } = await supabase.from("quiz_answers").insert(toInsert);
          if (insertErr) throw Errors.SERVER_ERROR();
        }
      }

      return await this.completeSession(session);
    }

    // SKIP → son soru muydu?
    if (session.current_q >= session.total_questions) {
      return await this.completeSession(session);
    }

    await this.incrementCurrentQ(session);
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
