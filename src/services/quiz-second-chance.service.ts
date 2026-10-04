import { supabase } from "../config/supabase.js";
import { economyConfigService } from "./economy-config.service.js";

/** `quiz_answers.power_used` — ücretsiz ikinci şansla kurtarılan cevap (analitik bu değerle sayar). */
export const FREE_SECOND_CHANCE = "FREE_SECOND_CHANCE";

interface SessionRef {
  id: string;
  solver_id: string;
}

/**
 * İlk quiz ikinci şansı (karar 2026-10-04, ilk gün tutma planı #4). Yeni kullanıcıda 55 quiz'in
 * 39'u ilk yanlışta bitti; ilk başarısızlıktan sonra 5/14 hiç devam etmedi.
 *
 * Kural (`economy.quizOnboarding`): oturum kullanıcının ilk `freeSecondChanceSessionWindow` quiz
 * oturumundan biri, bu oturumda henüz kullanılmamış ve kullanıcının toplam kullanımı
 * `freeSecondChances`'tan az. Sayaç ayrı kolon değil, kurtarılan cevabın `power_used` değeri —
 * migration gerektirmez; pencere küçük olduğu için sayım iki küçük sorgu.
 *
 * Tüketim atomikliği burada değil: `quizService.rescueWithSkip` yanlış cevabı koşullu yazımla
 * (is_correct=false → true) talep eder; aynı cevaba gelen iki eş zamanlı kurtarmadan yalnız biri
 * kazanır. Sınır: kullanıcı aynı anda İKİ ayrı quiz'de yanlış yapıp ikisini aynı anda kurtarırsa
 * pencere boyunca (en fazla `sessionWindow`) kullanım olabilir — mobil tek quiz yürütür.
 *
 * Fail-closed: config/sorgu hatasında uygun DEĞİL — ücretli kurtarma eskisi gibi çalışır.
 */
class QuizSecondChanceService {
  async isEligible(session: SessionRef): Promise<boolean> {
    let freeSecondChances: number;
    let sessionWindow: number;
    try {
      const { quizOnboarding } = await economyConfigService.getConfig();
      freeSecondChances = quizOnboarding.freeSecondChances;
      sessionWindow = quizOnboarding.freeSecondChanceSessionWindow;
    } catch (err) {
      console.error("[quiz-second-chance] config unavailable:", err);
      return false;
    }
    if (freeSecondChances <= 0) return false;

    const { data: firstSessions, error: sessErr } = await supabase
      .from("quiz_sessions")
      .select("id")
      .eq("solver_id", session.solver_id)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(sessionWindow);
    if (sessErr || !firstSessions) {
      console.error("[quiz-second-chance] session window read failed:", sessErr, { sessionId: session.id });
      return false;
    }
    const windowIds = firstSessions.map((s) => s.id as string);
    if (!windowIds.includes(session.id)) return false;

    const { data: used, error: usedErr } = await supabase
      .from("quiz_answers")
      .select("session_id")
      .in("session_id", windowIds)
      .eq("power_used", FREE_SECOND_CHANCE);
    if (usedErr || !used) {
      console.error("[quiz-second-chance] usage read failed:", usedErr, { sessionId: session.id });
      return false;
    }
    if (used.some((u) => u.session_id === session.id)) return false;
    return used.length < freeSecondChances;
  }
}

export const quizSecondChanceService = new QuizSecondChanceService();
