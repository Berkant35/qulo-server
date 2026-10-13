/**
 * derive-seed-persona.ts'in saf parçaları (DB/LLM yok → test edilebilir): persona kurulumu ve locale kapsamı.
 * Kişilik etiketi HAM geçer: bot dil paketleri (src/services/seed-locale) İtalyanca "Estroversa/Introverso"yu da tanır.
 */
import { responderTypeFor, styleFor } from "../../src/services/seed-persona.js";
import type { SeedPersona, WorkPattern } from "../../src/types/seed-persona.js";
import { TR_SEED_LOCALE, parseSeedEmail, personaSeedKey, type SeedLocale } from "./locales.js";

/** Persona + IANA saat dilimi (zamanlama `tz ?? Europe/Istanbul` okur; uyku penceresi o dilimin yerel dakikası). */
export type SeedPersonaTz = SeedPersona & { tz: string };

const UYKU_SAATI = 7 * 60;

/**
 * Kova anahtarı: TR `seed_NNNN` (mevcut 416 persona aynı kovada), diğer locale `it_NNNN`. Uyku: 00:30 ± 90 dk (anahtardaki
 * numaradan), vardiya_gece'de 08:00 ± 90 dk; 7 saat.
 */
export function buildSeedPersona(input: {
  email: string | null; userId: string; personality: string | null; pattern: WorkPattern; cfg: SeedLocale; model: string; now: Date;
}): { seedKey: string; persona: SeedPersonaTz } {
  const seedKey = personaSeedKey(input.email, input.userId);
  const kayma = (parseInt(seedKey.replace(/\D/g, "") || "0", 10) % 181) - 90;
  const start = input.pattern === "vardiya_gece" ? (8 * 60 + kayma + 1440) % 1440 : (30 + kayma + 1440) % 1440;
  return {
    seedKey,
    persona: {
      responder_type: responderTypeFor(seedKey, input.personality),
      work_pattern: input.pattern,
      sleep_window: { start_min: start, end_min: (start + UYKU_SAATI) % 1440 },
      style: styleFor(seedKey),
      derived_at: input.now.toISOString(),
      model: input.model,
      tz: input.cfg.tz,
    },
  };
}

/**
 * Persona yazılacak satırın locale'i: `--locale` verildiyse yalnız o locale'in TAM e-posta deseni (LIKE `_` jokerinin
 * yakaladığı `seed-it_elle` gibi satırlar dışarıda; aksi hâlde TR yapılandırmasına düşüp İstanbul saati alırdı). Kapsam yoksa
 * e-posta önekinden; seed deseni olmayan eski satır TR (tarihî davranış). Yapılandırması bulunamayan önek → null (atlanır).
 */
export function localeForSeedRow(
  email: string | null, scope: SeedLocale | null, resolve: (prefix: string) => SeedLocale | null,
): SeedLocale | null {
  const prefix = parseSeedEmail(email)?.prefix ?? null;
  if (scope) return prefix === scope.keyPrefix ? scope : null;
  if (!prefix) return TR_SEED_LOCALE;
  return resolve(prefix);
}
