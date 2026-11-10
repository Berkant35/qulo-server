import { questionLocale } from "../constants/locales.js";
import { mediaBadges, type QuestionMediaColumns } from "./question-media.service.js";

/**
 * Discover / undo kartinin `question_info` ozeti (saf kurallar; matching.service'ten ayrildi).
 */

export interface QuestionInfo {
  count: number;
  categories: string[];
  avg_difficulty: string;
  languages: string[];
  /**
   * Sesli/gorselli soru rozetleri (2.0.18+101) — yalniz medya kapisi acikken VAR (eski istemciye anahtar
   * hic gitmez). Izleyicinin dilindeki sorular + yalniz `approved` gorsel (`mediaBadges`).
   */
  has_voice?: boolean;
  has_image?: boolean;
}

/** Soru ozeti icin okunan satir (istatistik + dil; kapi acikken medya kolonlari). */
export type QuestionSummaryRow = QuestionMediaColumns & {
  category?: string | null;
  stats_correct: number;
  stats_wrong: number;
  locale?: string | null;
};

/**
 * Kartin `question_info`'su — discover ve undo ayni kurali kullanir (undo edilen kart listenin basina
 * eklenir, digerleriyle tutarli olmali). Sayilar ve diller TUM sorulardan (eski davranis); rozetler
 * yalniz `badgeLangs` verilince (kapi acik) ve yalniz o dillerdeki sorulardan.
 */
export function buildQuestionInfo(rows: readonly QuestionSummaryRow[], badgeLangs: readonly string[] | null): QuestionInfo {
  let totalAttempts = 0;
  let totalCorrect = 0;
  for (const q of rows) {
    totalAttempts += q.stats_correct + q.stats_wrong;
    totalCorrect += q.stats_correct;
  }
  const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 50;

  let difficulty = "unranked";
  if (totalAttempts >= 10) {
    if (successRate > 70) difficulty = "easy";
    else if (successRate > 40) difficulty = "medium";
    else if (successRate > 20) difficulty = "hard";
    else difficulty = "legendary";
  }

  const info: QuestionInfo = {
    count: rows.length,
    categories: [...new Set(rows.map((q) => q.category).filter(Boolean))] as string[],
    avg_difficulty: difficulty,
    languages: [...new Set(rows.map((q) => questionLocale(q.locale)))],
  };
  return badgeLangs ? { ...info, ...mediaBadges(rows, badgeLangs) } : info;
}
