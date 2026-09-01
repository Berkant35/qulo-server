import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LOCALES } from '../constants/locales.js';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
const EMAILS_DIR = join(LOCALES_DIR, 'emails');
const REFERENCE = 'en';

/** İç içe objeyi "push.new_message" gibi düz key listesine indirger. */
function flatten(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

function load(dir: string, locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf-8'));
}

/** Placeholder'lar: "{name} size {count} mesaj" → ["name", "count"] */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function leafValues(obj: unknown, prefix = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafValues(v, prefix ? `${prefix}.${k}` : k),
  );
}

// Push bildirimleri ve e-postalar iki ayrı sözlük — ikisini de aynı kurallarla denetliyoruz.
const BUNDLES: Array<{ label: string; dir: string }> = [
  { label: 'push (src/locales)', dir: LOCALES_DIR },
  { label: 'email (src/locales/emails)', dir: EMAILS_DIR },
];

for (const { label, dir } of BUNDLES) {
  describe(`locale parity — ${label}`, () => {
    it('desteklenen her dil için dosya var', () => {
      const missing = SUPPORTED_LOCALES.filter((l) => !existsSync(join(dir, `${l}.json`)));
      expect(missing, `eksik locale dosyası: ${missing.join(', ')}`).toEqual([]);
    });

    it('fazladan/artık locale dosyası yok', () => {
      const onDisk = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
      const extra = onDisk.filter((l) => !(SUPPORTED_LOCALES as readonly string[]).includes(l));
      expect(extra, `SUPPORTED_LOCALES'te olmayan dosya: ${extra.join(', ')}`).toEqual([]);
    });

    it(`her dil ${REFERENCE} ile birebir aynı key setine sahip`, () => {
      const reference = flatten(load(dir, REFERENCE)).sort();
      const problems: string[] = [];

      for (const locale of SUPPORTED_LOCALES) {
        if (locale === REFERENCE) continue;
        const keys = flatten(load(dir, locale)).sort();
        const missing = reference.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !reference.includes(k));
        if (missing.length) problems.push(`${locale}: EKSİK → ${missing.join(', ')}`);
        if (extra.length) problems.push(`${locale}: FAZLA → ${extra.join(', ')}`);
      }

      expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
    });

    it('hiçbir çeviri boş değil', () => {
      const problems: string[] = [];
      for (const locale of SUPPORTED_LOCALES) {
        for (const [key, value] of leafValues(load(dir, locale))) {
          if (!value.trim()) problems.push(`${locale}.${key}`);
        }
      }
      expect(problems, `boş çeviri: ${problems.join(', ')}`).toEqual([]);
    });

    // En sinsi hata: çevirmen {name}'i {isim} yapar, runtime'da ham placeholder görünür.
    it(`placeholder'lar ${REFERENCE} ile aynı`, () => {
      const reference = new Map(
        leafValues(load(dir, REFERENCE)).map(([k, v]) => [k, placeholders(v)]),
      );
      const problems: string[] = [];

      for (const locale of SUPPORTED_LOCALES) {
        if (locale === REFERENCE) continue;
        for (const [key, value] of leafValues(load(dir, locale))) {
          const expected = reference.get(key);
          if (!expected) continue; // key parity testi zaten yakalar
          const actual = placeholders(value);
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            problems.push(`${locale}.${key}: bekleniyor {${expected.join('},{')}} → bulunan {${actual.join('},{')}}`);
          }
        }
      }

      expect(problems, `\n${problems.join('\n')}\n`).toEqual([]);
    });
  });
}
