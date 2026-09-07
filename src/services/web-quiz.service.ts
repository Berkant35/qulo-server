import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { shuffleArray } from "../utils/math.js";
import { hashIp } from "../utils/hash.js";
import { generateShortCode } from "../utils/short-code.js";
import {
  WEB_QUIZ_BANK_POOL,
  WEB_QUIZ_BANK_SAMPLE,
  WEB_QUIZ_PURGE_GRACE_DAYS,
  WEB_QUIZ_TTL_DAYS,
} from "../constants/web-quiz.js";
import type { CreateWebQuizInput } from "../validators/web-quiz.validator.js";

/**
 * "Beni çözebilir misin?" — hesapsız, paylaşılabilir web testi.
 *
 * Neden var: Qulo'nun çekirdek mekaniği (soruya doğru cevap ver, eşleş) uygulama
 * dışında hiç görünmüyordu. Bu servis aynı mekaniği tek bir linke indirger:
 * kullanıcı soru bankasından 5 soru seçip kendi cevabını işaretler, arkadaşları
 * linkten oynar, sonuç kartı paylaşılır, CTA mağazaya gider. Soru metni yalnızca
 * `ai_question_bank`'tan gelir — tek serbest metin takma addır, moderasyon yükü yok.
 */
const SLUG_ATTEMPTS = 5;
const UNIQUE_VIOLATION = "23505";

interface BankRow {
  id: string;
  locale: string;
  question_text: string;
  answers: string[];
}

export interface WebQuizQuestion {
  bank_id: string;
  question_text: string;
  answers: string[];
  correct: number;
}

interface WebQuizRow {
  id: string;
  slug: string;
  locale: string;
  nickname: string;
  questions: WebQuizQuestion[];
  plays: number;
}

export interface PublicWebQuiz {
  slug: string;
  locale: string;
  nickname: string;
  plays: number;
  questions: Array<{ question_text: string; answers: string[] }>;
}

export interface AttemptResult {
  nickname: string;
  score: number;
  total: number;
  results: Array<{ chosen: number; correct: number; is_correct: boolean }>;
}

export class WebQuizService {
  generateSlug(): string {
    return generateShortCode();
  }

  /** Oluşturma ekranı için havuz: en çok seçilen 60 sorudan rastgele 12'si. */
  async getBankSample(locale: string): Promise<Array<Omit<BankRow, "locale">>> {
    const { data, error } = await supabase
      .from("ai_question_bank")
      .select("id, locale, question_text, answers")
      .eq("locale", locale)
      .eq("is_active", true)
      .order("selected_count", { ascending: false })
      .limit(WEB_QUIZ_BANK_POOL);
    if (error) throw Errors.SERVER_ERROR();

    return shuffleArray((data ?? []) as BankRow[])
      .slice(0, WEB_QUIZ_BANK_SAMPLE)
      .map(({ id, question_text, answers }) => ({ id, question_text, answers }));
  }

  async create(input: CreateWebQuizInput, ip: string): Promise<{ slug: string }> {
    const ids = input.items.map((i) => i.bank_id);
    const { data, error } = await supabase
      .from("ai_question_bank")
      .select("id, locale, question_text, answers")
      .in("id", ids)
      .eq("is_active", true);
    if (error) throw Errors.SERVER_ERROR();

    const byId = new Map(((data ?? []) as BankRow[]).map((r) => [r.id, r]));
    const allValid = ids.every((id) => byId.get(id)?.locale === input.locale);
    if (!allValid) throw Errors.WEB_QUIZ_BAD_QUESTIONS();

    // Soru metni ve şıklar o anki hâliyle dondurulur: banka sonradan değişse de
    // paylaşılan link hep aynı testi gösterir.
    const questions: WebQuizQuestion[] = input.items.map((item) => {
      const row = byId.get(item.bank_id)!;
      return {
        bank_id: row.id,
        question_text: row.question_text,
        answers: row.answers,
        correct: item.correct,
      };
    });

    const expiresAt = new Date(Date.now() + WEB_QUIZ_TTL_DAYS * 86_400_000).toISOString();

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const slug = this.generateSlug();
      const { error: insertErr } = await supabase.from("web_quizzes").insert({
        slug,
        locale: input.locale,
        nickname: input.nickname,
        questions,
        creator_ip_hash: hashIp(ip),
        expires_at: expiresAt,
      });
      if (!insertErr) return { slug };
      if (insertErr.code !== UNIQUE_VIOLATION) throw Errors.SERVER_ERROR();
    }
    throw Errors.SERVER_ERROR();
  }

  /** Aktif ve süresi dolmamış satır; süre filtresi DB'de (expires_at index'i) — yok/dolmuş ayrımı verilmez. */
  private async load(slug: string): Promise<WebQuizRow> {
    const { data, error } = await supabase
      .from("web_quizzes")
      .select("id, slug, locale, nickname, questions, plays")
      .eq("slug", slug.toUpperCase())
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.WEB_QUIZ_NOT_FOUND();
    return data as WebQuizRow;
  }

  /** Oynayan kişiye giden hâli — doğru cevaplar dışarı çıkmaz. */
  async getPublic(slug: string): Promise<PublicWebQuiz> {
    const row = await this.load(slug);
    return {
      slug: row.slug,
      locale: row.locale,
      nickname: row.nickname,
      plays: row.plays,
      questions: row.questions.map(({ question_text, answers }) => ({ question_text, answers })),
    };
  }

  async attempt(slug: string, answers: number[]): Promise<AttemptResult> {
    const row = await this.load(slug);
    if (answers.length !== row.questions.length) {
      throw Errors.VALIDATION_ERROR({ answers: ["must match question count"] });
    }

    const results = row.questions.map((q, i) => ({
      chosen: answers[i],
      correct: q.correct,
      is_correct: answers[i] === q.correct,
    }));
    const score = results.filter((r) => r.is_correct).length;

    // Oynanış satırı + plays sayacı tek transaction'da (migration 049). İstatistik
    // yazımı sonucu bloklamaz: hata loglanır, oynayan kişi skorunu her durumda görür.
    const { error } = await supabase.rpc("web_quiz_record_attempt", {
      p_quiz_id: row.id,
      p_score: score,
      p_total: row.questions.length,
      p_answers: answers,
    });
    if (error) console.warn("[web-quiz] attempt stats write failed:", error.message);

    return { nickname: row.nickname, score, total: row.questions.length, results };
  }

  /** Süresi dolan testleri (attempts cascade) siler; günlük cron çağırır. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - WEB_QUIZ_PURGE_GRACE_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("web_quizzes")
      .delete()
      .lt("expires_at", cutoff)
      .select("id");
    if (error) throw Errors.SERVER_ERROR();
    return data?.length ?? 0;
  }
}

export const webQuizService = new WebQuizService();
