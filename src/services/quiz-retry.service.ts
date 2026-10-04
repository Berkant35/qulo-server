import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { subscriptionService } from "./subscription.service.js";
import { DEFAULT_QUIZ_ONBOARDING } from "../types/economy-config.schema.js";
import { economyConfigService } from "./economy-config.service.js";

/**
 * Başarısız quiz'in hedefine tek tekrar (kullanıcı kararı 2026-10-04, ilk gün tutma planı #4).
 *
 * Eskiden quiz öncesi atılan LIKE `swipes`'ta kalıyor ve Discover hedefi KALICI dışlıyordu: tek
 * yanlış = o kişiyi bir daha görmemek (55 quiz'in 39'u başarısız). Yeni kural, hedef başına:
 *  - son oturum başarısız (FAILED ya da süresi geçmiş IN_PROGRESS = yarıda bırakılmış),
 *  - toplam başarısız oturum < MAX_FAILED_ATTEMPTS (ilk deneme + 1 tekrar),
 *  - son başarısızlıktan `failedRetryDays` gün geçti YA DA hedef o tarihten sonra yeni soru ekledi
 *    (`questions.created_at`; yerinde düzenleme ölçülemiyor — tabloda `updated_at` yok).
 *
 * Kural TEK yerde: Discover (geri dönüş + dışlama) ve `quizService.startSession` (kapı) aynı
 * `evaluateRetry` sonucunu kullanır — biri izin verip diğeri reddedemez.
 *
 * Eşleşme (aktif ya da pasif) varsa tekrar YOK: Discover bunu `matches`'tan eler (çözücü geçmişi
 * COMPLETED okumaz — tamamlanan oturum her zaman `matches` satırı üretir); çift bazlı okumalar
 * (`loadPairHistory`) COMPLETED'ı da okur, son oturum tamamlanmışsa karar `open` olur.
 */
export const MAX_FAILED_ATTEMPTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `quiz_sessions` satırının kural için gereken kısmı. */
export interface RetrySessionRow {
  target_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

/**
 * - `fresh`: bu hedefle başarısız oturum yok (kural uygulanmaz)
 * - `open`: son oturum sürüyor (süresi geçmemiş IN_PROGRESS) ya da tamamlanmış (COMPLETED) — kapı yok
 * - `eligible`: tekrar hakkı açık
 * - `cooldown`: tekrar hakkı var ama bekleme süresi dolmadı
 * - `exhausted`: tekrar hakkı kullanıldı
 * - `disabled`: özellik kapalı (`failedRetryDays = 0`) ve en az bir başarısızlık var
 */
export type RetryVerdict = "fresh" | "open" | "eligible" | "cooldown" | "exhausted" | "disabled";

/** Tekrar quiz'i başlatılamayan kararlar (Discover dışlar, swipe/undo/start reddeder). */
export const LOCKED_VERDICTS: ReadonlySet<RetryVerdict> = new Set(["cooldown", "exhausted", "disabled"]);

const PAIR_COLUMNS = "target_id, status, started_at, completed_at, expires_at";

export interface RetryEvaluation {
  verdict: RetryVerdict;
  lastFailedAt: Date | null;
  /** `cooldown` iken tekrarın açılacağı an. */
  retryAt: Date | null;
}

function failedAt(s: RetrySessionRow, now: Date): Date | null {
  if (s.status === "FAILED") return new Date(s.completed_at ?? s.expires_at ?? s.started_at);
  // Yarıda bırakılan oturum (uygulama kapandı / süre doldu) cron'la kapanmaz; IN_PROGRESS kalır.
  if (s.status === "IN_PROGRESS" && s.expires_at != null && new Date(s.expires_at) < now) {
    return new Date(s.expires_at);
  }
  return null;
}

/**
 * Tek hedef için karar. `sessions` o hedefin FAILED/IN_PROGRESS (çift okumalarında COMPLETED da)
 * oturumları; sıra önemsiz.
 * `questionCreatedAts`: hedefin çözücü dilindeki sorularının oluşturulma zamanları.
 */
export function evaluateRetry(
  sessions: readonly RetrySessionRow[],
  opts: { retryDays: number; now: Date; questionCreatedAts?: readonly (string | null)[] },
): RetryEvaluation {
  if (sessions.length === 0) return { verdict: "fresh", lastFailedAt: null, retryAt: null };

  const sorted = [...sessions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const latestFailedAt = failedAt(sorted[0], opts.now);
  if (latestFailedAt == null) return { verdict: "open", lastFailedAt: null, retryAt: null };

  const failedCount = sorted.filter((s) => failedAt(s, opts.now) != null).length;
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    return { verdict: "exhausted", lastFailedAt: latestFailedAt, retryAt: null };
  }
  if (opts.retryDays <= 0) return { verdict: "disabled", lastFailedAt: latestFailedAt, retryAt: null };

  const questionsChanged = (opts.questionCreatedAts ?? []).some(
    (c) => c != null && Date.parse(c) > latestFailedAt.getTime(),
  );
  const retryAt = new Date(latestFailedAt.getTime() + opts.retryDays * DAY_MS);
  if (questionsChanged || opts.now >= retryAt) {
    return { verdict: "eligible", lastFailedAt: latestFailedAt, retryAt: null };
  }
  return { verdict: "cooldown", lastFailedAt: latestFailedAt, retryAt };
}

class QuizRetryService {
  /** `economy.quizOnboarding.failedRetryDays` (5 dk önbellekli config). Okunamazsa varsayılan. */
  async getRetryDays(): Promise<number> {
    try {
      const { quizOnboarding } = await economyConfigService.getConfig();
      return quizOnboarding.failedRetryDays;
    } catch (err) {
      console.error("[quiz-retry] config unavailable, using default:", err);
      return DEFAULT_QUIZ_ONBOARDING.failedRetryDays;
    }
  }

  /**
   * Çözücünün başarısız/yarım oturumları, hedefe göre gruplu — Discover'da TEK sorgu (COMPLETED
   * okunmaz: eşleşme `matches`'tan gelir). Hata yutulmaz ama Discover'ı da düşürmez: `null` döner,
   * çağıran eski davranışa (tekrar yok) düşer.
   */
  async loadSolverHistory(solverId: string): Promise<Map<string, RetrySessionRow[]> | null> {
    const { data, error } = await supabase
      .from("quiz_sessions")
      .select(PAIR_COLUMNS)
      .eq("solver_id", solverId)
      .in("status", ["FAILED", "IN_PROGRESS"])
      .order("started_at", { ascending: false })
      .limit(5000);
    if (error) {
      console.error("[quiz-retry] solver history read failed:", error.message, { solverId });
      return null;
    }
    const byTarget = new Map<string, RetrySessionRow[]>();
    for (const row of (data ?? []) as RetrySessionRow[]) {
      const list = byTarget.get(row.target_id);
      if (list) list.push(row);
      else byTarget.set(row.target_id, [row]);
    }
    return byTarget;
  }

  /** Tek çiftin oturumları (COMPLETED dahil, en yeni önce). Okuma hatası SERVER_ERROR — kapı sessiz açılmaz. */
  async loadPairHistory(solverId: string, targetId: string): Promise<(RetrySessionRow & { id: string })[]> {
    const { data, error } = await supabase
      .from("quiz_sessions")
      .select(`id, ${PAIR_COLUMNS}`)
      .eq("solver_id", solverId)
      .eq("target_id", targetId)
      .in("status", ["FAILED", "IN_PROGRESS", "COMPLETED"])
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("[quiz-retry] pair history read failed:", error.message, { solverId, targetId });
      throw Errors.SERVER_ERROR();
    }
    return (data ?? []) as (RetrySessionRow & { id: string })[];
  }

  /**
   * Swipe/undo yolu için çift kararı. Bekleme sürüyorsa hedefin son başarısızlıktan sonra soru ekleyip
   * eklemediği okunur (yalnız o durumda — tek küçük sorgu). Sınır: burada dil ayrımı yok (çözücü dili
   * quiz servisinde); okuyamadığı dilde yeni soru ekleyen hedefte swipe geçer, `startSession` reddeder.
   */
  async pairVerdict(solverId: string, targetId: string): Promise<RetryEvaluation> {
    const sessions = await this.loadPairHistory(solverId, targetId);
    const opts = { retryDays: await this.getRetryDays(), now: new Date() };
    const first = evaluateRetry(sessions, opts);
    if (first.verdict !== "cooldown") return first;

    const { data: questions, error } = await supabase
      .from("questions")
      .select("created_at")
      .eq("user_id", targetId)
      .limit(20);
    if (error) {
      console.error("[quiz-retry] target questions read failed:", error.message, { targetId });
      return first;
    }
    const questionCreatedAts = (questions ?? []).map((q) => (q.created_at as string | null) ?? null);
    return evaluateRetry(sessions, { ...opts, questionCreatedAts });
  }

  /**
   * Tekrar denemesi için mevcut LIKE satırını yenile (UNIQUE swiper+target: yeni satır açılamaz).
   * Karar (2026-10-04): ikinci deneme de günlük keşif hakkından BİR kez düşer — ilk denemeyle
   * tutarlı, tekrar "bedava keşif" olmasın.
   *
   * Idempotent: satır son başarısızlıktan ÖNCE atılmışsa bu yeni bir denemedir; `created_at` koşullu
   * (CAS) yenilenir, yalnız yarışı kazanan istek hakkı harcar. Yenilenmiş satır tekrar harcatmaz.
   * Hak dolmuşsa yenileme geri alınır ve DAILY_LIMIT_EXCEEDED yukarı fırlatılır (ilk LIKE ile aynı).
   * Kilitli hedefte (bekleme/hak bitti/kapalı) QUIZ_RETRY_LOCKED — hak düşmeden.
   */
  async renewLike(solverId: string, targetId: string, swipeId: string, likedAt: string): Promise<void> {
    const { verdict, lastFailedAt, retryAt } = await this.pairVerdict(solverId, targetId);
    if (LOCKED_VERDICTS.has(verdict)) {
      throw Errors.QUIZ_RETRY_LOCKED(verdict as "cooldown" | "exhausted" | "disabled", retryAt);
    }
    if (verdict !== "eligible" || !lastFailedAt || Date.parse(likedAt) >= lastFailedAt.getTime()) return;

    const renewedAt = new Date().toISOString();
    const { data: renewed, error: renewError } = await supabase
      .from("swipes")
      .update({ created_at: renewedAt })
      .eq("id", swipeId)
      .eq("created_at", likedAt)
      .select("id")
      .maybeSingle();
    if (renewError) {
      console.error("[quiz-retry] like renew failed:", renewError.message, { solverId, targetId });
      throw Errors.SERVER_ERROR();
    }
    if (!renewed) return; // eş zamanlı istek yeniledi ve hakkı o harcadı

    try {
      await subscriptionService.incrementDailySwipes(solverId);
    } catch (err) {
      const { error: revertError } = await supabase
        .from("swipes")
        .update({ created_at: likedAt })
        .eq("id", swipeId)
        .eq("created_at", renewedAt);
      if (revertError) {
        console.error("[quiz-retry] like revert failed:", revertError.message, { solverId, targetId });
      }
      throw err;
    }
  }

  /** Kilitli hedefe yeni LIKE / undo hak harcamadan reddedilir (undo eskiden bedava tekrar yoluydu). */
  async assertNotLocked(solverId: string, targetId: string): Promise<void> {
    const { verdict, retryAt } = await this.pairVerdict(solverId, targetId);
    if (LOCKED_VERDICTS.has(verdict)) {
      throw Errors.QUIZ_RETRY_LOCKED(verdict as "cooldown" | "exhausted" | "disabled", retryAt);
    }
  }
}

export const quizRetryService = new QuizRetryService();
