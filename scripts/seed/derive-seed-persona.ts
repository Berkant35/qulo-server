// scripts/seed/derive-seed-persona.ts
import { supabase } from '../../src/config/supabase.js';
import { styleFor, responderTypeFor } from '../../src/services/seed-persona.js';
import { generateSeedReply, SEED_LLM_MODEL } from '../../src/services/seed-llm.service.js';
import type { SeedPersona, WorkPattern } from '../../src/types/seed-persona.js';

const DESENLER: WorkPattern[] = ['ofis', 'vardiya_aksam', 'vardiya_gece', 'okul', 'hafta_sonu_yogun', 'serbest', 'esnek'];
const PARTI = 40;

/** PostgREST sorgusu URL'de gidiyor: 416 id icin tek bir .in() ~16 KB header sinirini asiyor
 *  (dogrulandi: HeadersOverflowError). Ayni parcali .in() cozumu seed-reply.service.ts'de de var (ID_PARCA=100). */
const ID_PARCA = 100;

interface KullaniciDetay { user_id: string; job: string | null; personality: string | null }

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
      'Her meslegi su calisma desenlerinden birine esle:',
      'ofis (hafta ici 09-18), vardiya_aksam (18-01), vardiya_gece (gece), okul (hafta ici gunduz),',
      'hafta_sonu_yogun (cumartesi-pazar yogun), serbest (duzensiz), esnek (desen yok).',
      'Yalniz JSON dondur: {"meslek adi":"desen", ...}. Baska hicbir sey yazma.',
    ].join('\n');
    const { text } = await generateSeedReply({ system: sistem, turns: [{ role: 'user', text: parca.join('\n') }] });
    try {
      const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as Record<string, string>;
      for (const [meslek, desen] of Object.entries(json)) {
        harita.set(meslek, DESENLER.includes(desen as WorkPattern) ? (desen as WorkPattern) : 'esnek');
      }
    } catch {
      console.warn(`[derive] parti ${i / PARTI + 1} JSON cozulemedi, esnek'e dusuruldu`);
    }
    console.log(`[derive] ${Math.min(i + PARTI, meslekler.length)}/${meslekler.length} meslek islendi`);
  }
  return harita;
}

/** seed_id benzeri sabit bir anahtar: e-posta (seed-tr_0582@qulo.seed) → seed_0582. */
function seedIdOf(email: string, fallback: string): string {
  const m = /seed-tr_(\d+)@/.exec(email);
  return m ? `seed_${m[1]}` : fallback;
}

async function main() {
  const kuru = process.argv.includes('--dry-run');

  const { data: kullanicilar, error } = await supabase
    .from('users')
    .select('id, email, seed_persona')
    .eq('is_seed_profile', true);
  if (error) throw error;

  const hedefler = (kullanicilar ?? []).filter((u) => !u.seed_persona);
  console.log(`seed profil: ${kullanicilar?.length ?? 0} · persona eksik: ${hedefler.length}`);
  if (!hedefler.length) return;

  const detayOf = await detaylariGetir(hedefler.map((u) => u.id as string));

  const meslekler = [...new Set([...detayOf.values()].map((d) => String(d.job ?? '')).filter(Boolean))];
  console.log(`benzersiz meslek: ${meslekler.length} → ~${Math.ceil(meslekler.length / PARTI)} LLM cagrisi`);
  const desenOf = kuru ? new Map<string, WorkPattern>() : await deseniCikar(meslekler);

  let yazilan = 0;
  for (const u of hedefler) {
    const seedId = seedIdOf(String(u.email ?? ''), String(u.id));
    const detay = detayOf.get(u.id as string);
    // Uyku penceresi: 00:30 ± 90 dk, 7 saat uyku. Vardiya_gece'de ters cevrilir.
    const desen = desenOf.get(String(detay?.job ?? '')) ?? 'esnek';
    const kayma = (parseInt(seedId.replace(/\D/g, '') || '0', 10) % 181) - 90;
    const start = desen === 'vardiya_gece' ? (8 * 60 + kayma + 1440) % 1440 : (30 + kayma + 1440) % 1440;

    const persona: SeedPersona = {
      responder_type: responderTypeFor(seedId, (detay?.personality as string) ?? null),
      work_pattern: desen,
      sleep_window: { start_min: start, end_min: (start + 7 * 60) % 1440 },
      style: styleFor(seedId),
      derived_at: new Date().toISOString(),
      model: SEED_LLM_MODEL,
    };

    if (kuru) { console.log(seedId, JSON.stringify(persona)); continue; }
    const { error: yazErr } = await supabase.from('users').update({ seed_persona: persona }).eq('id', u.id);
    if (yazErr) console.error(`[derive] ${seedId} yazilamadi: ${yazErr.message}`);
    else yazilan += 1;
  }
  console.log(kuru ? 'kuru kosu bitti' : `yazilan: ${yazilan}/${hedefler.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
