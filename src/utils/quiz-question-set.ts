import { questionLocale } from "../constants/locales.js";

/** Bir profilin Discover'da gorunmesi ve quiz'in acilmasi icin gereken en az soru sayisi. */
export const MIN_QUIZ_QUESTIONS = 2;

/** Soru satirlarinin dilleri (normalize: `questionLocale`). Discover ve quiz ayni normalizasyonu paylasir. */
export function questionLocalesOf(questions: ReadonlyArray<{ locale?: unknown }>): string[] {
  return questions.map((q) => questionLocale(q.locale));
}

/**
 * Izleyicinin dillerinde TOPLAM >= MIN_QUIZ_QUESTIONS soru var mi (dil basina degil).
 * Dil listesi bossa filtre yok: herkes "kendi dili" sayilir. Discover dil kapisinin tek tanimi.
 */
export function hasEnoughInLanguages(questionLocales: readonly string[], solverLanguages: readonly string[]): boolean {
  if (solverLanguages.length === 0) return true;
  return questionLocales.filter((l) => solverLanguages.includes(l)).length >= MIN_QUIZ_QUESTIONS;
}

/**
 * Quiz'in soru kumesi (startSession ve oturumun yeniden hesaplandigi tum yollar bu fonksiyonu kullanir).
 * - Izleyici dilinde >= MIN soru varsa YALNIZ onlar (eski davranis).
 * - Degilse hedefin TUM sorulari: izleyici dili once, sonra digerleri; her grupta gelen (order_num) sira.
 *   Boylece Discover'da yabanci dil grubunda gorunen profil (K3) quiz'de NO_QUESTIONS atmaz.
 * - Toplam < MIN ise bos dizi (cagiran NO_QUESTIONS atar).
 * `questions` order_num sirasinda gelmelidir.
 */
export function selectQuizQuestions<T extends { locale?: unknown }>(
  questions: readonly T[],
  solverLanguages: readonly string[],
): T[] {
  if (questions.length < MIN_QUIZ_QUESTIONS) return [];
  if (solverLanguages.length === 0) return [...questions];
  const own = questions.filter((q) => solverLanguages.includes(questionLocale(q.locale)));
  if (own.length >= MIN_QUIZ_QUESTIONS) return own;
  const others = questions.filter((q) => !solverLanguages.includes(questionLocale(q.locale)));
  return [...own, ...others];
}
