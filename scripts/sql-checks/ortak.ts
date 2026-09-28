/**
 * SQL senaryo sinamalarinin ortak parcasi: fonksiyonu tanimlayan migration'i bulur ve govdesini
 * gecici semaya tasir. Sinama deseni (DO blogu + gecici sema + sonda RAISE EXCEPTION ile geri alma)
 * `seed-reply-candidates.ts` basligindadir.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** SQL metin sabiti; tek tirnak kacisli (senaryo metnine kesme isareti girerse SQL bozulmasin). */
export const q = (s: string | null): string => (s === null ? 'NULL' : `'${s.replaceAll("'", "''")}'`);

const imza = (fonksiyon: string) => `CREATE OR REPLACE FUNCTION ${fonksiyon}(`;

/** `--migration <yol>` verilmediyse fonksiyonu tanimlayan EN SON migration. */
export function migrationSec(fonksiyon: string): string {
  const i = process.argv.indexOf('--migration');
  if (i > 0 && process.argv[i + 1]) return join(KOK, process.argv[i + 1]!);
  const tanimlayan = readdirSync(join(KOK, 'migrations'))
    .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
    .sort()
    .filter((f) => readFileSync(join(KOK, 'migrations', f), 'utf8').includes(imza(fonksiyon)));
  if (!tanimlayan.length) throw new Error(`${fonksiyon} tanimlayan migration yok`);
  return join(KOK, 'migrations', tanimlayan[tanimlayan.length - 1]!);
}

/**
 * Migration'daki fonksiyonu gecici semaya tasir (elle kopya YOK): ad semayla nitelenir,
 * `search_path` semaya cevrilir. Donusum eksikse durur — sinanan SQL uretimdekiyle ayni olmali.
 */
export function fonksiyonGovdesi(yol: string, fonksiyon: string, sema: string): string {
  const src = readFileSync(yol, 'utf8');
  const bas = src.indexOf(imza(fonksiyon));
  const son = src.indexOf('$$;', bas);
  if (bas < 0 || son < 0) throw new Error(`fonksiyon govdesi bulunamadi: ${yol}`);
  const fn = src.slice(bas, son + 3)
    .replace(imza(fonksiyon), `CREATE FUNCTION ${sema}.${fonksiyon}(`)
    .replace('SET search_path = public, pg_temp', `SET search_path = ${sema}, pg_temp`)
    .replace('AS $$', 'AS $fn$')
    .replace(/\$\$;$/, '$fn$;');
  if (fn.includes('$$') || !fn.includes(`${sema}, pg_temp`) || !fn.includes(`${sema}.${fonksiyon}(`)) {
    throw new Error('donusum eksik — sinanan SQL uretimdekiyle ayni olmayabilir');
  }
  return fn;
}
