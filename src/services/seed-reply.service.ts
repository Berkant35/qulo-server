import { supabase } from '../config/supabase.js';
import { isBusy, fazFor, VARSAYILAN_PERSONA } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';
import { chatService } from './chat.service.js';
import { buildPersonaCard, personaGirdisi, type SeedProfilSatiri } from './seed-persona.js';
import { validateReply } from './seed-reply-guard.js';
import { generateSeedReply } from './seed-llm.service.js';
import { chatQuestionService } from './chat-question.service.js';
import { createChatQuestionSchema } from '../validators/chat-question.validator.js';
import {
  krizCevabi, PAKETSIZ_DIL, seedLocalePack, seedPaketiKesin, TR_PAKETI, yasAltiBeyani, type SeedLocalePack,
} from './seed-locale/index.js';

// Tarama ayri modulde (seed-reply-scan.service.ts); cron ve testler tek giris noktasindan alir.
export { fazFor } from './seed-reply-timing.js';
export { scanAndEnqueue, type SeedAdayi } from './seed-reply-scan.service.js';

/** Bir kuyruk satirinin isleme sonucu. Cron dallanmasi bu kumeye gore tip denetlenir. */
export type IslemSonucu = 'sent' | 'deferred' | 'cancelled' | 'failed';

export interface QueueRow {
  id: string;
  match_id: string;
  seed_user_id: string;
  trigger_message_id: string | null;
  question_id: string | null;
  media_request_id: string | null;
  kind: 'message' | 'question' | 'question_answer' | 'media_request';
  reply_due_at: string;
  status: string;
  attempts: number;
}

/** `__QUESTION__:<uuid>` bir soru karti isaretidir, mesaj metni degil. */
const QUESTION_ONEKI = '__QUESTION__';

/** Mesaj satirinin LLM'e gidecek hali. */
interface MesajSatiri { content?: unknown; is_image?: unknown; audio_url?: unknown }

/**
 * Bot medyayi GOREMEZ/DUYAMAZ. Foto mesajinda `content` ham storage URL'si,
 * sesli mesajda sabit bir metindir ("Sesli mesaj"); ikisi de ham gecirilirse model
 * bunlari karsi tarafin YAZDIGI metin sanip alakasiz cevap yazar — ya da URL'yi
 * taklit etmeye calisir ve cikti denetimine takilir. Etiketle gecirilince model
 * ne oldugunu bilir ve gormus gibi yapmaz. Etiket seed'in dilinde (persona kartiyla ayni).
 */
export function mesajMetni(m: MesajSatiri, paket: SeedLocalePack = TR_PAKETI): string {
  if (m.audio_url) return paket.etiket.sesli;
  if (m.is_image) return paket.etiket.foto;
  const c = String(m.content ?? '');
  return c.startsWith(QUESTION_ONEKI) ? paket.etiket.soruKarti : c;
}

/**
 * Yazma kapisi IKI kolonun birden dogru olmasidir. Discover `is_test_account` filtreliyor
 * (matching.service.ts:176), bot ise `is_seed_profile` hedefliyordu. Bugun ortusuyorlar
 * ama bunu zorlayan bir kisit yok: bir seed'de `is_test_account=false` yapilirsa profil
 * gercek kullanicilara acilir VE bot ona cevap yazmaya devam ederdi.
 */
export function botYazabilir<T extends { is_seed_profile?: unknown; is_test_account?: unknown }>(
  u: T | null | undefined,
): u is T {
  return Boolean(u?.is_seed_profile) && Boolean(u?.is_test_account);
}

export const KAPI_HATASI = 'alici seed profil degil (is_seed_profile + is_test_account)';

export async function claimDue(limit: number): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc('claim_seed_replies', { p_limit: limit });
  if (error) {
    console.error('[SeedReply] claim hatasi:', error.message);
    return [];
  }
  return (data ?? []) as QueueRow[];
}

async function durumYaz(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('seed_reply_queue')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[SeedReply] durum yazilamadi:', error.message);
}

export const markSent = (id: string) => durumYaz(id, { status: 'sent' });
export const markFailed = (id: string, error: string) => durumYaz(id, { status: 'failed', last_error: error.slice(0, 500) });
export const markCancelled = (id: string, reason: string) => durumYaz(id, { status: 'cancelled', last_error: reason.slice(0, 500) });
export const deferRow = (id: string, ms: number) =>
  durumYaz(id, { status: 'pending', reply_due_at: new Date(Date.now() + ms).toISOString() });

/** Spec §7: hata/timeout → satir `pending`'e doner, ustel backoff; 3 denemede `failed`. */
const BACKOFF_MS = [30_000, 2 * 60_000, 8 * 60_000];
const MAX_DENEME = 3;

/**
 * LLM hatasi ve cikti-denetimi basarisizligi satiri DOGRUDAN oldurmez.
 * `claim_seed_replies` claim aninda `attempts`'i artirir, yani ilk deneme `attempts = 1`.
 */
export async function backoffVeyaBitir(row: QueueRow, hata: string): Promise<'deferred' | 'failed'> {
  if (row.attempts >= MAX_DENEME) {
    await markFailed(row.id, hata);
    return 'failed';
  }
  const adim = Math.min(Math.max(row.attempts - 1, 0), BACKOFF_MS.length - 1);
  await deferRow(row.id, BACKOFF_MS[adim]!);
  return 'deferred';
}

// --- withinRateLimits: servis katmani hiz sinirlari (Task 11) --------------

const ESLESME_GUNLUK = 40;
const PROFIL_SAATLIK = 12;

/** chatLimiter servis cagrisinda devrede DEGIL (yalnizca HTTP katmaninda); fren burada. */
export async function withinRateLimits(matchId: string, seedUserId: string, now: Date = new Date()): Promise<boolean> {
  const gunBasi = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const saatBasi = new Date(now.getTime() - 60 * 60_000).toISOString();

  const { count: gunluk } = await supabase
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('match_id', matchId).eq('sender_id', seedUserId).gte('created_at', gunBasi);
  if ((gunluk ?? 0) >= ESLESME_GUNLUK) {
    console.warn(`[SeedReply] eslesme gunluk tavani match=${matchId}`);
    return false;
  }

  const { count: saatlik } = await supabase
    .from('messages').select('id', { count: 'exact', head: true })
    .eq('sender_id', seedUserId).gte('created_at', saatBasi);
  if ((saatlik ?? 0) >= PROFIL_SAATLIK) {
    console.warn(`[SeedReply] profil saatlik tavani seed=${seedUserId}`);
    return false;
  }
  return true;
}

/** Coken instance'in biraktigi satirlari kurtarir. */
export async function recoverStale(olderThanMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data } = await supabase
    .from('seed_reply_queue')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'claimed')
    .lt('claimed_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}

// --- processRow: orkestrasyon (Task 7) -------------------------------------

// Guvenlik kapilari (kriz, 18 yas alti) DILDEN BAGIMSIZ ve fail-closed: tum paketlerin birlesimi +
// normalize metin (seed-locale/guvenlik.ts). Insan seed'e her zaman seed'in dilinde yazmaz.

/** Karsi taraf konusmayi kapatiyor mu (uyuyacak, isi var, "gorusuruz"). Guvenlik degil: paket ozel. */
export function kapanisSinyali(text: string, paket: SeedLocalePack = TR_PAKETI): boolean {
  return paket.kapanis.test(text);
}

const GECMIS_LIMIT = 20;

/** `last_error` degeri; ayni zamanda eslesmenin KALICI yas alti isareti (bkz. yasAltiIsaretli). */
export const YAS_ALTI_SEBEBI = '18 yas alti beyani';

interface GecmisMesaji extends MesajSatiri { sender_id?: unknown }

/**
 * Gecmisteki HERHANGI bir insan mesaji 18 yas alti beyani mi. Yalniz son mesaj sinanirken
 * "ho 16 anni" + "e tu?" ya da sustuktan sonra "ciao?" botu yeniden konusturuyordu (inceleme 2026-10-13).
 */
export function gecmisteYasAlti(gecmis: readonly GecmisMesaji[], seedUserId: string, paket: SeedLocalePack): boolean {
  return gecmis.some((m) => m.sender_id !== seedUserId && yasAltiBeyani(mesajMetni(m, paket)));
}

/**
 * Eslesmede daha once yas alti beyani yakalanmis mi: iptal edilmis kuyruk satiri kalici isarettir
 * (beyan GECMIS_LIMIT'in disina kaysa da bot susmaya devam eder). Okuma hatasi FIRLATILIR — bilinmeyen
 * durum "yaz" demek olmasin (fail-closed); cron satiri geri birakir.
 */
async function yasAltiIsaretli(matchId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('seed_reply_queue').select('id', { count: 'exact', head: true })
    .eq('match_id', matchId).eq('status', 'cancelled').eq('last_error', YAS_ALTI_SEBEBI);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Soru yollari (seedBaglami kullanmayan) icin: kalici isaret + son gecmis. */
async function yasAltiDurumu(row: QueueRow, paket: SeedLocalePack): Promise<boolean> {
  const [isaretli, gecmisSonuc] = await Promise.all([
    yasAltiIsaretli(row.match_id),
    supabase.from('messages')
      .select('sender_id, content, is_image, audio_url')
      .eq('match_id', row.match_id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(GECMIS_LIMIT),
  ]);
  if (gecmisSonuc.error) throw gecmisSonuc.error;
  return isaretli || gecmisteYasAlti(gecmisSonuc.data ?? [], row.seed_user_id, paket);
}

/**
 * Bot bir sey yazdi: cevrimici bayragi ve son gorulme BIRLIKTE tazelenir.
 * Yalniz `last_seen_at` yazilirsa sohbet basliginda "cevrimdisi" gorunurken
 * saniyeler icinde cevap gelir — celiskinin ta kendisi. Bir sonraki presence
 * tikinde (en fazla 5 dk) profil dogal ritmine doner.
 */
export async function aktifIsaretle(seedUserId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_online: true, last_seen_at: new Date().toISOString() })
    .eq('id', seedUserId);
  if (error) console.warn('[SeedReply] presence yazilamadi:', error.message);
}

/** Persona karti icin gereken seed alanlari; `personaGirdisi` ile ayni sozlesme. */
export type SeedSatiri = SeedProfilSatiri & { seed_persona?: unknown };

export interface SeedBaglami {
  sistem: string;
  turns: Array<{ role: 'model' | 'user'; text: string }>;
  /** Son INSAN mesajinin LLM'e giden hali; kriz kapisi bunun uzerinde calisir. */
  sonInsanMetni: string;
  /** Eslesmede yas alti beyani var (kalici isaret ya da gecmisteki herhangi bir insan mesaji). */
  yasAlti: boolean;
  /** Seed'in dil paketi — kart, etiketler ve cikti denetimi AYNI paketle calisir. */
  paket: SeedLocalePack;
}

/**
 * Bir satir icin LLM baglamini kurar: persona karti + kirpilmis sohbet gecmisi.
 * Metin cevabi ve medya gecistirmesi AYNI baglami kullanir; ayrildiklari yer
 * uretim POLITIKASI (uyari-probe'lu iki deneme vs tek deneme), baglam degil.
 */
export async function seedBaglami(
  row: QueueRow,
  seed: SeedSatiri,
  paket: SeedLocalePack,
  opts: { mediaAsk?: boolean } = {},
): Promise<SeedBaglami> {
  const [detaySonuc, sayim, gecmisSonuc, isaretli] = await Promise.all([
    supabase.from('user_details')
      .select('job, personality, pets, music_type, smoking, alcohol')
      .eq('user_id', row.seed_user_id).maybeSingle(),
    // Faz TEK kaynaktan: gercek mesaj sayisi. Kirpilmis gecmisten (GECMIS_LIMIT=20)
    // hesaplanirsa fazFor'a en fazla 20 gider ve faz 4 (nazik kapanis) ASLA olusmaz.
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('match_id', row.match_id).is('deleted_at', null),
    supabase.from('messages')
      .select('sender_id, content, is_image, audio_url')
      .eq('match_id', row.match_id).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(GECMIS_LIMIT),
    yasAltiIsaretli(row.match_id),
  ]);

  // Gecmis sessizce bos donerse model SIFIR baglamla yazar ve o cevap gonderilir.
  if (gecmisSonuc.error) throw gecmisSonuc.error;

  const gecmis = (gecmisSonuc.data ?? []).slice().reverse();
  const sonInsan = [...gecmis].reverse().find((m) => m.sender_id !== row.seed_user_id);
  // Medya etiketli: yas/kriz/kapanis desenleri bir storage URL'sinde aranmaz.
  const sonInsanMetni = sonInsan ? mesajMetni(sonInsan, paket) : '';

  const persona = (seed.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
  const sistem = buildPersonaCard(personaGirdisi(seed, detaySonuc.data ?? null, {
    persona,
    phase: fazFor(sayim.count ?? 0),
    busyNow: isBusy(persona, new Date()),
    // Medya istegi kendi baglamini tasir; ikisi ayni promptta celisirdi.
    partnerClosing: !opts.mediaAsk && kapanisSinyali(sonInsanMetni, paket),
    mediaAsk: opts.mediaAsk,
  }));

  const turns = gecmis.map((m) => ({
    role: (m.sender_id === row.seed_user_id ? 'model' : 'user') as 'model' | 'user',
    text: mesajMetni(m, paket),
  }));
  // Medya istegi bir mesaj degil, bir eylem: gecmise `mesajMetni` ile ayni dilde girer.
  if (opts.mediaAsk) turns.push({ role: 'user' as const, text: paket.etiket.medyaIstegi });

  const yasAlti = isaretli || gecmisteYasAlti(gecmis, row.seed_user_id, paket);
  return { sistem, turns, sonInsanMetni, yasAlti, paket };
}

/**
 * `last_error` sutununa yazilacak kisa kod. LLM hatalarinda kod TEK BASINA yetersiz:
 * `seed-llm.service` hem HTTP durum hatasini hem ag hatasini `http` kodu altinda
 * topluyor, yani "llm: http" satiri "401 mi, 429 mu, ag mi" sorusunu cevaplamiyordu
 * (canli ornek 2026-09-21). Kod + mesajin bas kismi birlikte yazilir.
 */
export function hataKodu(err: unknown): string {
  const kod = (err as { code?: string })?.code;
  const mesaj = (err as Error)?.message ?? '';
  if (!kod) return String(mesaj);
  return mesaj ? `${kod}: ${mesaj.slice(0, 120)}` : String(kod);
}

/**
 * Kuyruktan alinan bir satiri isler: persona karti kurar, LLM'den cevap uretir,
 * denetimden gecirir ve mevcut sohbet servisiyle gonderir.
 *
 * Kimlik cift kontrolu — tarama sorgusundaki WHERE tek savunma hatti sayilmaz;
 * bu feature'in en yuksek sonuclu hata modu botun gercek bir kullanici hesabindan
 * yazmasidir, bu yuzden gonderimden ONCE `botYazabilir` ile tekrar dogrulanir.
 */
export async function processRow(row: QueueRow): Promise<IslemSonucu> {
  const { data: seed, error: seedHata } = await supabase
    .from('users')
    .select('id, name, age, city, bio, gender, interests, relationship_goal, locale, is_seed_profile, is_test_account, seed_persona')
    .eq('id', row.seed_user_id)
    .maybeSingle();
  // Gecici okuma hatasi kimlik kapisina dusup satiri kalici iptal etmesin.
  if (seedHata) return backoffVeyaBitir(row, `seed okunamadi: ${seedHata.message}`);
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }
  const paket = seedPaketiKesin(seed.locale);
  if (!paket) {
    await markCancelled(row.id, `${PAKETSIZ_DIL}: ${String(seed.locale)}`);
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  const { sistem, turns, sonInsanMetni, yasAlti } = await seedBaglami(row, seed, paket);

  if (yasAlti) {
    await markCancelled(row.id, YAS_ALTI_SEBEBI);
    return 'cancelled';
  }

  // Rolu birak: kriz cevabi sabit ve LLM'den GECMEZ (dil: eslesen dil, yoksa seed'in dili).
  let metin: string | null = krizCevabi(sonInsanMetni, paket);

  if (metin === null) {
    for (let deneme = 0; deneme < 2 && metin === null; deneme += 1) {
      const sistemProbe = deneme === 0 ? sistem : `${sistem}${paket.uyariProbe}`;
      let ham: string;
      try {
        ham = (await generateSeedReply({ system: sistemProbe, turns })).text;
      } catch (err) {
        return backoffVeyaBitir(row, `llm: ${hataKodu(err)}`);
      }
      const denetim = validateReply(ham, sistem, paket);
      if (denetim.ok) metin = denetim.text;
      else console.warn(`[SeedReply] cikti elendi (${denetim.reason}) match=${row.match_id} deneme=${deneme + 1}`);
    }

    if (metin === null) {
      // Sessizlik, hazir kalip cevaptan daha gercekcidir (kalip tekrari en buyuk ele verme kaynagi).
      return backoffVeyaBitir(row, 'cikti denetimi iki denemede de gecilemedi');
    }
  }

  try {
    await chatService.sendMessage(row.seed_user_id, row.match_id, metin);
  } catch (err) {
    const kod = hataKodu(err);
    if (kod.includes('CHAT_LOCKED')) {
      await deferRow(row.id, 2 * 60_000);
      return 'deferred';
    }
    if (kod.includes('NOT_MATCHED') || kod.includes('MATCH_INACTIVE') || kod.includes('USER_BLOCKED')) {
      await markCancelled(row.id, kod);
      return 'cancelled';
    }
    await markFailed(row.id, kod);
    return 'failed';
  }

  // "3 gun once goruldu" yazarken canli cevap yazma tutarsizligini kapat.
  await aktifIsaretle(row.seed_user_id);
  await markSent(row.id);
  return 'sent';
}

// --- askQuestion / answerQuestionRow: soru mekanigi (Task 8) ---------------

const SIKLAR = ['A', 'B', 'C', 'D'] as const;
/** Riski olmayan soruda botun dogru bilme olasiligi — her zaman bilmek gercekci degil. */
const DOGRU_OLASILIGI = 0.65;

export async function askQuestion(row: QueueRow): Promise<IslemSonucu> {
  const { data: seed, error: seedHata } = await supabase
    .from('users').select('id, name, age, city, bio, locale, is_seed_profile, is_test_account, seed_persona')
    .eq('id', row.seed_user_id).maybeSingle();
  if (seedHata) return backoffVeyaBitir(row, `seed okunamadi: ${seedHata.message}`);
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }
  // Soru, son insan mesajina metin cevabinin YERINE gecer: o mesaj yas beyani olabilir.
  const paket = seedPaketiKesin(seed.locale);
  if (!paket) {
    await markCancelled(row.id, `${PAKETSIZ_DIL}: ${String(seed.locale)}`);
    return 'cancelled';
  }
  if (await yasAltiDurumu(row, paket)) {
    await markCancelled(row.id, YAS_ALTI_SEBEBI);
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  const { data: detay } = await supabase
    .from('user_details').select('job, personality, pets, music_type').eq('user_id', row.seed_user_id).maybeSingle();

  // Soru seed'in dilinde uretilir: eslesen insan o dili okur (Discover dil kapisi).
  const talimat = paket.soruTalimati({
    name: String(seed.name), job: (detay?.job as string | null | undefined) ?? null, bio: (seed.bio as string | null) ?? null,
  });

  let ham: string;
  try {
    ham = (await generateSeedReply({ system: talimat, turns: [{ role: 'user', text: paket.soruTetik }] })).text;
  } catch (err) {
    return backoffVeyaBitir(row, `llm: ${hataKodu(err)}`);
  }

  const json = ham.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let aday: unknown;
  try { aday = JSON.parse(json); } catch { aday = null; }

  const parsed = createChatQuestionSchema.safeParse({
    ...(aday as Record<string, unknown> ?? {}),
    time_limit_seconds: 30,
    has_unmatch_risk: false,   // SABIT — yanlis cevap eslesmeyi bitirir
    has_chat_lock: false,      // SABIT — kilit iki tarafi birden baglar
    use_power_block: false,    // SABIT — seed profillerin mor elmasi yok
  });
  if (!parsed.success) {
    return backoffVeyaBitir(row, `soru semasi gecersiz: ${parsed.error.issues[0]?.message ?? ''}`);
  }

  try {
    await chatQuestionService.createQuestion(row.match_id, row.seed_user_id, parsed.data);
  } catch (err) {
    const kod = hataKodu(err);
    // Gunluk limit (ucretsiz kademe: eslesme basina 2) ve kilit normal durumlardir.
    if (kod.includes('DAILY_LIMIT_EXCEEDED') || kod.includes('CHAT_LOCKED') ||
        kod.includes('NOT_MATCHED') || kod.includes('MATCH_INACTIVE')) {
      await markCancelled(row.id, kod);
      return 'cancelled';
    }
    await markFailed(row.id, kod);
    return 'failed';
  }

  await aktifIsaretle(row.seed_user_id);
  await markSent(row.id);
  return 'sent';
}

export async function answerQuestionRow(row: QueueRow): Promise<IslemSonucu> {
  // Kimlik cift kontrolu — processRow/askQuestion ile AYNI kapi. Soru cevabi da bir yazma
  // yoludur (soruyu SORANA yesil elmas kazandirir); bu feature'in en yuksek sonuclu hata
  // modu botun gercek bir kullanici hesabindan yazmasidir, yani her yazma yolu dogrular.
  const { data: seed, error: seedHata } = await supabase
    .from('users').select('id, locale, is_seed_profile, is_test_account').eq('id', row.seed_user_id).maybeSingle();
  if (seedHata) return backoffVeyaBitir(row, `seed okunamadi: ${seedHata.message}`);
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }
  // Cevap da etkilesimdir: yas alti beyani olan eslesmede bot soruyu da cevaplamaz.
  if (await yasAltiDurumu(row, seedLocalePack(seed.locale))) {
    await markCancelled(row.id, YAS_ALTI_SEBEBI);
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  if (!row.question_id) {
    await markCancelled(row.id, 'question_id yok');
    return 'cancelled';
  }
  const { data: soru } = await supabase
    .from('chat_questions')
    .select('id, sender_id, correct_option, answered_option, is_abandoned, has_unmatch_risk, option_count')
    .eq('id', row.question_id).maybeSingle();

  if (!soru || soru.sender_id === row.seed_user_id || soru.answered_option != null || soru.is_abandoned) {
    await markCancelled(row.id, 'soru cevaplanabilir durumda degil');
    return 'cancelled';
  }

  const dogru = String(soru.correct_option) as typeof SIKLAR[number];
  // Riskli soruda ASLA yanlis cevaplamayiz: yanlis cevap ve terk, ikisi de unmatch tetikler.
  const sikSayisi = Number(soru.option_count ?? 4) === 2 ? 2 : 4;
  const secim = soru.has_unmatch_risk || Math.random() < DOGRU_OLASILIGI
    ? dogru
    : SIKLAR.slice(0, sikSayisi).filter((s) => s !== dogru)[Math.floor(Math.random() * (sikSayisi - 1))]!;

  try {
    // ASLA null gondermeyiz — terk de unmatch tetikler.
    await chatQuestionService.answerQuestion(row.question_id, row.seed_user_id, secim);
  } catch (err) {
    const kod = hataKodu(err);
    if (kod.includes('ALREADY_ANSWERED') || kod.includes('NOT_MATCHED') || kod.includes('MATCH_INACTIVE')) {
      await markCancelled(row.id, kod);
      return 'cancelled';
    }
    await markFailed(row.id, kod);
    return 'failed';
  }

  await aktifIsaretle(row.seed_user_id);
  await markSent(row.id);
  return 'sent';
}
