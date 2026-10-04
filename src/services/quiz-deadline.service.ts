import { supabase } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";
import { economyConfigService } from "./economy-config.service.js";

/** `questions.time_limit` bos ise (eski satirlar). */
export const DEFAULT_QUESTION_SECONDS = 30;
/** Sure bilinemezse (eski oturum / okuma hatasi) — `question.validator` ust siniri; sunum anı daraltir. */
const MAX_QUESTION_SECONDS = 300;
/** Kosullu yazim yarisinda yeniden deneme sayisi (diamond CAS ile ayni olcek). */
const CAS_ATTEMPTS = 3;

/**
 * `current_q_powers`'a yazilan ic isaretler (037 `quiz_session_mark_power` ile atomik; soru
 * gecisinde dizi sifirlaninca hak yenilenir). Istemciye `used_powers` icinde DONMEZLER.
 * - PAYWALL: ek sure bu soruda verildi (soru basina bir kez).
 * - RESCUE: yanlis cevap kaydedildi, kurtarma penceresi acik.
 */
const PAYWALL_MARKER = "__PAYWALL_GRACE";
const RESCUE_MARKER = "__RESCUE_WINDOW";
const INTERNAL_MARKERS: ReadonlySet<string> = new Set([PAYWALL_MARKER, RESCUE_MARKER]);
/** Bu isaretlerden biri varsa sunum son ani DARALTMAZ: odenmis/verilmis sure geri alinmasin. */
const NO_REARM: ReadonlySet<string> = new Set(["TIME_EXTEND", PAYWALL_MARKER, RESCUE_MARKER]);

/** Deadline islemlerinin ihtiyac duydugu oturum alanlari. */
export interface DeadlineSession {
  id: string;
  current_q: number;
  expires_at: string;
  current_q_powers: string[] | null;
}

const secondsFromNow = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

export const remainingSeconds = (expiresAt: string): number =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

/** Istemciye donen kullanilmis gucler — ic isaretler haric. */
export const visiblePowers = (powers: string[] | null): string[] =>
  (powers ?? []).filter((p) => !INTERNAL_MARKERS.has(p));

/**
 * Quiz son ani — SORU BASINA (2026-10-04). Eski kural "tum sorularin toplami + 10 sn" paywall, guc
 * sayfasi ve soru gecis animasyonu sirasinda da isliyordu: istemci sayaci dururken sunucu suresi
 * bitiyor, kullanici TIME_UP aliyordu. Migration yok: mevcut `quiz_sessions.expires_at` kolonu
 * o anki sorunun son anini tutar.
 *
 * Yasam dongusu: oturum acilisi / soru gecisi → "sure + tolerans + gecis tamponu"; soru sunulunca
 * → "simdi + sure + tolerans"a DARALIR (asla uzamaz); TIME_EXTEND → +config; yetersiz elmas →
 * soru basina bir kez +paywall; yanlis cevap → kurtarma penceresi.
 */
class QuizDeadlineService {
  /** Oturum acilisi: ilk sorunun suresi + tolerans + gecis tamponu (tur/acilis animasyonu). */
  async initial(firstLimit: number | null | undefined): Promise<string> {
    const { timing } = await economyConfigService.getConfig();
    return secondsFromNow((firstLimit ?? DEFAULT_QUESTION_SECONDS) + timing.questionToleranceSeconds + timing.transitionGraceSeconds);
  }

  /** Soru gecisi: sonraki sorunun suresi + tolerans + gecis tamponu (geri bildirim animasyonu + soru cekme). */
  async transition(nextQuestionId: string | undefined): Promise<string> {
    const [{ timing }, nextLimit] = await Promise.all([
      economyConfigService.getConfig(),
      this.questionTimeLimit(nextQuestionId),
    ]);
    return secondsFromNow(nextLimit + timing.questionToleranceSeconds + timing.transitionGraceSeconds);
  }

  /**
   * Soru sunuldu: son ani "simdi + sure + tolerans"a DARALT. Kosullu yazim (`expires_at > yeni`)
   * sayesinde ayni soruyu tekrar cekmek sureyi sifirlamaz. TIME_EXTEND / paywall / kurtarma isareti
   * varsa hic dokunmaz — aksi halde tekrar cekmek ek sureyi "taze sure"ye cevirirdi (paywall'u
   * tetikle + tekrar cek = sure sifirlama) ya da kurtarma penceresini kisaltirdi.
   * Yarisi kaybederse (es zamanli iki GET) taze degeri okur; yazim hatasi akisi bozmaz.
   */
  async arm(session: DeadlineSession, timeLimit: number): Promise<string> {
    if ((session.current_q_powers ?? []).some((p) => NO_REARM.has(p))) return session.expires_at;

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
      console.error("[quiz-deadline] arm failed:", error, { sessionId: session.id });
      return session.expires_at;
    }
    if (data) return data.expires_at as string;
    return (await this.readExpiresAt(session.id)) ?? session.expires_at;
  }

  /**
   * Son ani `seconds` kadar ileri al (TIME_EXTEND, paywall). Okunan degere KOSULLU yazim:
   * es zamanli baska bir yazim (ikinci uzatma, sunum daraltmasi) araya girerse taze degerle
   * yeniden dener — uzatma kaybolmaz, baskasinin yazdigi deger ezilmez.
   */
  async extend(session: DeadlineSession, seconds: number): Promise<void> {
    let current: string | null = session.expires_at;
    for (let attempt = 0; attempt < CAS_ATTEMPTS && current; attempt++) {
      const extended = new Date(new Date(current).getTime() + seconds * 1000).toISOString();
      const { data, error } = await supabase
        .from("quiz_sessions")
        .update({ expires_at: extended })
        .eq("id", session.id)
        .eq("current_q", session.current_q)
        .eq("expires_at", current)
        .select("id")
        .maybeSingle();
      if (error) break;
      if (data) return;
      current = await this.readExpiresAt(session.id, session.current_q);
    }
    console.error("[quiz-deadline] extend failed:", { sessionId: session.id, seconds });
  }

  /**
   * Yanlis cevap kaydedildi: kurtarma (SKIP/SKIP_ALL, gerekirse paywall) ya da vazgec karari icin
   * pencere. Yalniz uzatir; cevap yazildigi icin ek sure avantaj saglamaz. Isaret, pencere
   * acikken yapilan GET'in (uygulama yeniden acilisi) pencereyi daraltmasini engeller.
   */
  async openRescueWindow(session: DeadlineSession): Promise<void> {
    const { timing } = await economyConfigService.getConfig();
    const deadline = secondsFromNow(timing.rescueWindowSeconds);
    await this.mark(session.id, RESCUE_MARKER);
    const { error } = await supabase
      .from("quiz_sessions")
      .update({ expires_at: deadline })
      .eq("id", session.id)
      .eq("current_q", session.current_q)
      .lt("expires_at", deadline);
    if (error) console.error("[quiz-deadline] rescue window failed:", error, { sessionId: session.id });
  }

  /**
   * Yetersiz elmas → istemci paywall acar ve sayacini durdurur; sunucu son ani da soru basina
   * BIR KEZ `paywallGraceSeconds` uzar (isaret atomik — es zamanli iki istek iki kez uzatamaz).
   * Bilincli sinir: bakiyesi yetmeyen kullanici soru basina bir kez ek sure alabilir.
   * Baska hatalarda hicbir sey yapmaz; kendi hatasini yutar (asil hata firlatilmaya devam eder).
   */
  async grantPaywallGrace(session: DeadlineSession, cause: unknown): Promise<void> {
    if (!(cause instanceof AppError) || cause.code !== "INSUFFICIENT_DIAMONDS") return;
    try {
      if (!(await this.mark(session.id, PAYWALL_MARKER))) return;
      const { timing } = await economyConfigService.getConfig();
      await this.extend(session, timing.paywallGraceSeconds);
    } catch (err) {
      console.error("[quiz-deadline] paywall grace failed:", err, { sessionId: session.id });
    }
  }

  /** Sorunun suresi; bilinemezse ust sinir (sunum ani daraltir — comert taraf guvenli). */
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

  private async readExpiresAt(sessionId: string, currentQ?: number): Promise<string | null> {
    let query = supabase.from("quiz_sessions").select("expires_at").eq("id", sessionId);
    if (currentQ !== undefined) query = query.eq("current_q", currentQ);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data.expires_at as string;
  }

  /** Ic isareti ekle; true = bu cagri ekledi (daha once yoktu). */
  private async mark(sessionId: string, marker: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("quiz_session_mark_power", {
      p_session_id: sessionId,
      p_power: marker,
    });
    if (error) {
      console.error("[quiz-deadline] marker failed:", error, { sessionId, marker });
      return false;
    }
    return data === true;
  }
}

export const quizDeadlineService = new QuizDeadlineService();
