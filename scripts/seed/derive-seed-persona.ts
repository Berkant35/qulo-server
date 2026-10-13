// scripts/seed/derive-seed-persona.ts
/**
 * Persona'sı eksik seed profillerine yanıt tipi / çalışma deseni / uyku penceresi / stil (+ IANA `tz`) yazar.
 * Locale e-postadan çıkar (`seed-<prefix>_NNNN@qulo.seed` → seed-profiles/locales/<prefix>.json; TR gömülü): `tz` (uyku
 * penceresi o dilimin yerel dakikası; TR Europe/Istanbul, IT Europe/Rome). Saf kısım persona-derive-lib.ts'de (testli).
 * Okuma 1.000'lik sayfalarla (PostgREST max-rows), detaylar parçalı `.in()` ile; bilinmeyen bayrak/değersiz --locale hata.
 *
 *   npx tsx scripts/seed/derive-seed-persona.ts --dry-run [--locale it]
 */
import { supabase } from '../../src/config/supabase.js';
import { generateSeedReply, SEED_LLM_MODEL } from '../../src/services/seed-llm.service.js';
import type { WorkPattern } from '../../src/types/seed-persona.js';
import { fetchAll } from '../../src/utils/fetch-all.js';
import { parseFlags } from './cli-args.js';
import { resolveSeedLocale, seedEmailLike, type SeedLocale } from './locales.js';
import { buildSeedPersona, localeForSeedRow } from './persona-derive-lib.js';
const DESENLER: WorkPattern[] = ['ofis', 'vardiya_aksam', 'vardiya_gece', 'okul', 'hafta_sonu_yogun', 'serbest', 'esnek'];
const PARTI = 40;

/** PostgREST sorgusu URL'de gidiyor: 416 id icin tek bir .in() ~16 KB header sinirini asiyor
 *  (dogrulandi: HeadersOverflowError). Ayni parcali .in() cozumu seed-reply.service.ts'de de var (ID_PARCA=100). */
const ID_PARCA = 100;

interface KullaniciDetay { user_id: string; job: string | null; personality: string | null }
interface SeedSatiri { id: string; email: string | null; seed_persona: unknown }

async function detaylariGetir(ids: string[]): Promise<Map<string, KullaniciDetay>> {
  const harita = new Map<string, KullaniciDetay>();
  for (let i = 0; i < ids.length; i += ID_PARCA) {
    const parca = ids.slice(i, i + ID_PARCA);
    const { data, error } = await supabase
      .from('user_details').select('user_id, job, personality')
      .in('user_id', parca);
    if (error) throw error;
    for (const d of (data ?? []) as KullaniciDetay[]) harita.set(d.user_id, d);
  }
  return harita;
}

async function deseniCikar(meslekler: string[]): Promise<Map<string, WorkPattern>> {
  const harita = new Map<string, WorkPattern>();
  for (let i = 0; i < meslekler.length; i += PARTI) {
    const parca = meslekler.slice(i, i + PARTI);
    const sistem = [
      'Her meslegi su calisma desenlerinden birine esle (meslek adi herhangi bir dilde olabilir; adi AYNEN anahtar yap):',
      'ofis (hafta ici 09-18), vardiya_aksam (18-01), vardiya_gece (gece), okul (hafta ici gunduz),',
      'hafta_sonu_yogun (cumartesi-pazar yogun), serbest (duzensiz), esnek (desen yok).',
      'Yalniz JSON dondur: {"meslek adi":"desen", ...}. Baska hicbir sey yazma.',
    ].join('\n');
    // LLM cagrisi try'in ICINDE: bir partinin gecici hatasi (timeout/http) tum betigi
    // oldurmemeli — 416 satirin hicbiri yazilmadan cikilirdi. Bir kez yeniden denenir,
    // o da olmazsa bu partinin meslekleri 'esnek'e duser (KALICI: yeniden kosu duzeltmez).
    let islendi = false;
    for (let deneme = 1; deneme <= 2 && !islendi; deneme += 1) {
      try {
        const { text } = await generateSeedReply({ system: sistem, turns: [{ role: 'user', text: parca.join('\n') }] });
        const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as Record<string, string>;
        for (const [meslek, desen] of Object.entries(json)) {
          harita.set(meslek, DESENLER.includes(desen as WorkPattern) ? (desen as WorkPattern) : 'esnek');
        }
        islendi = true;
      } catch (err) {
        const mesaj = (err as Error)?.message ?? String(err);
        if (deneme === 1) {
          console.warn(`[derive] parti ${i / PARTI + 1} deneme 1 basarisiz (${mesaj}) — tekrar deneniyor`);
        } else {
          console.error(`[derive] parti ${i / PARTI + 1} IKI DENEMEDE DE BASARISIZ (${mesaj}) — bu partideki ${parca.length} meslek 'esnek'e dusuruldu (KALICI)`);
        }
      }
    }
    console.log(`[derive] ${Math.min(i + PARTI, meslekler.length)}/${meslekler.length} meslek islendi`);
  }
  return harita;
}

/** e-posta öneki → locale yapılandırması (önbellekli). Dosyası olmayan önek null (o satır atlanır); bozuk dosya FIRLATIR. */
function localeCozucu(): (onek: string) => SeedLocale | null {
  const onbellek = new Map<string, SeedLocale | null>();
  return (onek) => {
    if (!onbellek.has(onek)) {
      try {
        onbellek.set(onek, resolveSeedLocale(onek));
      } catch (err) {
        if ((err as Error).message.includes('ENOENT')) onbellek.set(onek, null);
        else throw err;
      }
    }
    return onbellek.get(onek) ?? null;
  };
}

async function main() {
  const args = parseFlags(process.argv.slice(2), { bool: ['--dry-run'], value: ['--locale'] });
  const kuru = args.has('--dry-run');
  const kapsam = args.has('--locale') ? resolveSeedLocale(args.get('--locale')) : null;

  let kullanicilar: SeedSatiri[];
  try {
    kullanicilar = await fetchAll<SeedSatiri>((from, to) => {
      const q = supabase.from('users').select('id, email, seed_persona').eq('is_seed_profile', true);
      return (kapsam ? q.like('email', seedEmailLike(kapsam)) : q).order('id').range(from, to);
    });
  } catch (err) {
    throw new Error(`seed okuma: ${(err as { message?: string }).message ?? String(err)}`);
  }

  const cozucu = localeCozucu();
  const hedefler = kullanicilar.filter((u) => !u.seed_persona);
  console.log(`seed profil: ${kullanicilar.length}${kapsam ? ` (${kapsam.locale})` : ''} · persona eksik: ${hedefler.length}`);
  if (!hedefler.length) return;

  const detayOf = await detaylariGetir(hedefler.map((u) => u.id));

  const meslekler = [...new Set([...detayOf.values()].map((d) => String(d.job ?? '')).filter(Boolean))];
  console.log(`benzersiz meslek: ${meslekler.length} → ~${Math.ceil(meslekler.length / PARTI)} LLM cagrisi`);
  const desenOf = kuru ? new Map<string, WorkPattern>() : await deseniCikar(meslekler);

  let yazilan = 0;
  for (const u of hedefler) {
    const cfg = localeForSeedRow(u.email, kapsam, cozucu);
    if (!cfg) { console.warn(`[derive] ${u.email}: kapsam dışı ya da locale yapılandırması yok — atlandı`); continue; }
    const detay = detayOf.get(u.id);
    const { seedKey, persona } = buildSeedPersona({
      email: u.email, userId: u.id, personality: detay?.personality ?? null,
      pattern: desenOf.get(String(detay?.job ?? '')) ?? 'esnek', cfg, model: SEED_LLM_MODEL, now: new Date(),
    });

    if (kuru) { console.log(seedKey, JSON.stringify(persona)); continue; }
    const { error: yazErr } = await supabase.from('users').update({ seed_persona: persona }).eq('id', u.id).eq('is_seed_profile', true);
    if (yazErr) console.error(`[derive] ${seedKey} yazilamadi: ${yazErr.message}`);
    else yazilan += 1;
  }
  console.log(kuru ? 'kuru kosu bitti' : `yazilan: ${yazilan}/${hedefler.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
