/**
 * LGBT havuzu (spec 2026-10-05 §5): mevcut hetero seed'lerin bir kısmı gey/lezbiyen
 * tercihine ayrılır (locale başına: split-lgbt-seeds.ts --locale it). Karşılıklı kural açılınca gey erkek / lezbiyen kadın destesi
 * boşalmasın diye. Yalnız sohbeti, eşleşmesi ve gelen beğenisi olmayan seed'ler;
 * biyografi/soru metninde cinsiyet atfı olanlar dışarıda (manuel kontrol dry-run'da).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "../../src/utils/fetch-all.js";
import { parseSeedEmail, seedEmailLike, type SeedLocale } from "./locales.js";

/** Kullanılan yüzey (gerçek istemci ve fake-supabase ikisi de uyar). */
type SplitClient = Pick<SupabaseClient, "from">;

export interface SeedCandidate {
  id: string;
  gender: "MAN" | "WOMAN";
  gender_pref: string | null;
  age: number | null;
  city: string | null;
  /** bio + soru metinleri + cevap şıkları */
  texts: string[];
  hasMatch: boolean;
  hasIncomingLike: boolean;
}

export interface SplitSelection {
  men: SeedCandidate[];
  women: SeedCandidate[];
  alreadyMen: number;
  alreadyWomen: number;
}

/**
 * Cinsiyet atfı sözlüğü (locale başına): önek eşleşen kökler + yalnız tam eşleşen kısa kelimeler. İngilizce her locale'de
 * geçerli (bio'larda karışık kullanım). Yanlış pozitif ("kızgın", "principale") zararsız: yalnız o seed ayrılmaz; dry-run'da
 * göz kontrolü var. Kısa kelimeler tam eşleşme: "bey" ≠ "beyaz", "man" ≠ "manzara", "uomo" ≠ "uomini" (ayrıca listede).
 */
const EN_STEMS = ["girlfriend", "boyfriend", "husband", "wife", "gentlem"];
const EN_WORDS = ["man", "men", "guy", "guys", "girl", "girls", "woman", "women", "lady", "ladies"];
const GENDER_WORDS: Record<string, { stems: readonly string[]; words: ReadonlySet<string> }> = {
  tr: {
    stems: ["kadın", "kadin", "kız", "kiz", "erkek", "bayan", "hanım", "hanim", "beyefendi", "yakışıklı", "yakisikli", "prenses", ...EN_STEMS],
    words: new Set(["adam", "adamı", "koca", "kocam", "karım", "karim", "bey", ...EN_WORDS]),
  },
  it: {
    // "tipo" (dolgu kelime), "bellissimo" (eşya için de) bilerek yok: her bio'yu elerdi.
    stems: ["donn", "ragazz", "femmin", "masch", "marit", "mogli", "fidanzat", "signor", "principess", ...EN_STEMS],
    words: new Set(["uomo", "uomini", "lui", "lei", "moroso", "morosa", ...EN_WORDS]),
  },
};
const LOWER_LOCALE: Record<string, string> = { tr: "tr-TR", it: "it-IT" };

export function mentionsGender(text: string, locale = "tr"): boolean {
  const dict = GENDER_WORDS[locale];
  // Sözlüğü olmayan locale'de TR'ye düşmek, cinsiyetli bio'ları "uygun" sayıp tercihlerini değiştirirdi → dur.
  if (!dict) throw new Error(`cinsiyet sözlüğü yok: ${locale} (lgbt-seed-split-lib.ts GENDER_WORDS)`);
  // tr-TR küçültmesi "I"yı "ı" yapar — İtalyanca metinde "Il/Io" bozulmasın diye locale'in kendi kuralı.
  const tokens = text.toLocaleLowerCase(LOWER_LOCALE[locale] ?? "en-US").split(/[^\p{L}]+/u).filter(Boolean);
  return tokens.some((t) => dict.words.has(t) || dict.stems.some((stem) => t.startsWith(stem)));
}

function eligible(c: SeedCandidate, locale: string): boolean {
  return !c.hasMatch && !c.hasIncomingLike && !c.texts.some((t) => mentionsGender(t, locale));
}

function ageBand(age: number | null): string {
  if (age == null) return "?";
  if (age < 25) return "<25";
  if (age < 30) return "25-29";
  if (age < 35) return "30-34";
  return "35+";
}

/** Gruplar (şehir × yaş bandı) arasında sırayla bir tane — tek şehre/yaşa yığılmaz. */
function roundRobin(cands: SeedCandidate[], need: number): SeedCandidate[] {
  const groups = new Map<string, SeedCandidate[]>();
  for (const cand of [...cands].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${cand.city ?? "?"}|${ageBand(cand.age)}`;
    groups.set(key, [...(groups.get(key) ?? []), cand]);
  }
  const queues = [...groups.keys()].sort().map((k) => groups.get(k)!);
  const picked: SeedCandidate[] = [];
  while (picked.length < need && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (picked.length >= need) break;
      const next = q.shift();
      if (next) picked.push(next);
    }
  }
  return picked;
}

export function selectSeedsForSplit(
  cands: SeedCandidate[], target: { men: number; women: number }, locale = "tr",
): SplitSelection {
  const alreadyMen = cands.filter((c) => c.gender === "MAN" && c.gender_pref === "MAN").length;
  const alreadyWomen = cands.filter((c) => c.gender === "WOMAN" && c.gender_pref === "WOMAN").length;
  const pool = (g: "MAN" | "WOMAN", hetero: string) => cands.filter((c) => c.gender === g && c.gender_pref === hetero && eligible(c, locale));
  return {
    men: roundRobin(pool("MAN", "WOMAN"), Math.max(0, target.men - alreadyMen)),
    women: roundRobin(pool("WOMAN", "MAN"), Math.max(0, target.women - alreadyWomen)),
    alreadyMen,
    alreadyWomen,
  };
}

const CHUNK = 100;
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

interface SeedRow { id: string; email?: string | null; gender: string; gender_pref: string | null; age: number | null; city: string | null; bio: string | null }
interface QuestionRow { user_id: string; question_text: string | null; answer_1: string | null; answer_2: string | null; answer_3: string | null; answer_4: string | null }

/**
 * Tüm okumalar `fetchAll` + sabit `.order("id")` ile sayfalanır: PostgREST 1000 satırda sessizce
 * kırpar; kırpılmış swipes cevabı bir seed'i, gerçek kullanıcı beğenmişken "uygun" gösterirdi.
 * `locale` verilirse yalnız o locale'in seed'leri (`seed-<prefix>_NNNN@qulo.seed`); verilmezse tüm seed'ler.
 */
export async function loadSeedCandidates(client: SplitClient, opts: { locale?: SeedLocale } = {}): Promise<SeedCandidate[]> {
  let seeds: SeedRow[];
  try {
    seeds = await fetchAll<SeedRow>((from, to) => {
      const q = client.from("users").select("id, email, gender, gender_pref, age, city, bio").eq("is_seed_profile", true).eq("is_deleted", false);
      return (opts.locale ? q.like("email", seedEmailLike(opts.locale)) : q).order("id").range(from, to);
    });
    // LIKE'a ek: yalnız tam `seed-<prefix>_NNNN` (elle açılmış `seed-it_elle` gibi satırlar kapsam dışı)
    const scope = opts.locale;
    if (scope) seeds = seeds.filter((s) => parseSeedEmail(s.email)?.prefix === scope.keyPrefix);
  } catch (err) {
    throw new Error(`seed okuma: ${(err as { message?: string }).message ?? err}`);
  }
  const ids = seeds.map((s) => s.id);
  const seedSet = new Set(ids);
  const texts = new Map<string, string[]>(ids.map((id) => [id, []]));
  const matched = new Set<string>();
  const liked = new Set<string>();

  // `.in()` URL sınırı: 416 id tek sorguya konmaz (memory: .in() tuzağı); her parça ayrıca sayfalanır.
  try {
    for (const part of chunks(ids)) {
      const [q, m1, m2, s] = await Promise.all([
        fetchAll<QuestionRow>((from, to) =>
          client.from("questions").select("user_id, question_text, answer_1, answer_2, answer_3, answer_4")
            .in("user_id", part).order("id").range(from, to)),
        fetchAll<{ user1_id: string }>((from, to) =>
          client.from("matches").select("user1_id").in("user1_id", part).order("id").range(from, to)),
        fetchAll<{ user2_id: string }>((from, to) =>
          client.from("matches").select("user2_id").in("user2_id", part).order("id").range(from, to)),
        fetchAll<{ swiper_id: string; target_id: string }>((from, to) =>
          client.from("swipes").select("swiper_id, target_id").eq("action", "LIKE")
            .in("target_id", part).order("id").range(from, to)),
      ]);
      for (const row of q) {
        texts.get(row.user_id)?.push(
          ...[row.question_text, row.answer_1, row.answer_2, row.answer_3, row.answer_4].filter((t): t is string => typeof t === "string"),
        );
      }
      for (const row of m1) matched.add(row.user1_id);
      for (const row of m2) matched.add(row.user2_id);
      for (const row of s) if (!seedSet.has(row.swiper_id)) liked.add(row.target_id);
    }
  } catch (err) {
    throw new Error(`aday okuma: ${(err as { message?: string }).message ?? err}`);
  }

  return seeds
    .filter((s) => s.gender === "MAN" || s.gender === "WOMAN")
    .map((s) => ({
      id: s.id,
      gender: s.gender as "MAN" | "WOMAN",
      gender_pref: s.gender_pref ?? null,
      age: s.age ?? null,
      city: s.city ?? null,
      texts: [...(typeof s.bio === "string" ? [s.bio] : []), ...(texts.get(s.id) ?? [])],
      hasMatch: matched.has(s.id),
      hasIncomingLike: liked.has(s.id),
    }));
}

export async function applySplit(client: SplitClient, sel: SplitSelection): Promise<{ men: number; women: number }> {
  // Bayat seçim satırı ezmesin: yalnız hâlâ seed ve hâlâ hetero tercihte olanlar güncellenir.
  const write = async (rows: SeedCandidate[], pref: "MAN" | "WOMAN", hetero: "MAN" | "WOMAN") => {
    let n = 0;
    for (const part of chunks(rows.map((r) => r.id))) {
      const { data, error } = await client.from("users").update({ gender_pref: pref })
        .in("id", part).eq("is_seed_profile", true).eq("gender_pref", hetero).select("id");
      if (error) throw new Error(`yazım: ${error.message}`);
      n += data?.length ?? 0;
    }
    return n;
  };
  return { men: await write(sel.men, "MAN", "WOMAN"), women: await write(sel.women, "WOMAN", "MAN") };
}
