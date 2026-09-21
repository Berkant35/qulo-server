import { supabase } from '../config/supabase.js';
import { computeReplyDelayMs, isBusy } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';
import { chatService } from './chat.service.js';
import { buildPersonaCard, personaGirdisi, type SeedProfilSatiri } from './seed-persona.js';
import { validateReply } from './seed-reply-guard.js';
import { generateSeedReply } from './seed-llm.service.js';
import { chatQuestionService } from './chat-question.service.js';
import { mediaService } from './media.service.js';
import { createChatQuestionSchema } from '../validators/chat-question.validator.js';

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

const VARSAYILAN_PERSONA: SeedPersona = {
  responder_type: 'normal', work_pattern: 'esnek',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 'fallback',
};

async function fastModeAcik(): Promise<boolean> {
  const { data } = await supabase.from('app_config').select('seed_reply_fast_mode').limit(1).maybeSingle();
  return Boolean(data?.seed_reply_fast_mode);
}

export function fazFor(messageCount: number): 1 | 2 | 3 | 4 {
  if (messageCount <= 10) return 1;
  if (messageCount <= 15) return 2;
  if (messageCount <= 24) return 3;
  return 4;
}

/** PostgREST sorgusu URL'de gidiyor: 416 seed icin tek bir .or() ifadesi ~42 KB olurdu
 *  (yaygin sunucu siniri ~8-16 KB). Parcali .in() hem sinirin altinda kaliyor hem
 *  fake-supabase'in destekledigi bicim. */
const ID_PARCA = 100;

/** Kalici basarisizliktan sonra ayni eslesmeye yeniden satir acmadan once beklenen sure. */
const SOGUMA_MS = 6 * 60 * 60_000;

/** Spec §6.1: faz 1'in son ucte biri (7-10. mesaj), %30 ihtimalle soru. */
const FAZ1_SON_UCTE_BIR = 7;
const SORU_OLASILIGI = 0.3;
/** Ucretsiz kademe: eslesme basina gunde 2 soru (chat-question.service.ts:258). */
const GUNLUK_SORU_KOTASI = 2;

/** fazFor bu sayidan itibaren 4 doner; kapanis, bu esikten SONRA yazilmis seed mesajidir. */
const FAZ4_ESIK = 25;

/** `__QUESTION__:<uuid>` bir soru karti isaretidir, mesaj metni degil. */
const QUESTION_ONEKI = '__QUESTION__';

/** Mesaj satirinin LLM'e gidecek hali. */
interface MesajSatiri { content?: unknown; is_image?: unknown; audio_url?: unknown }

/**
 * Bot medyayi GOREMEZ/DUYAMAZ. Foto mesajinda `content` ham storage URL'si,
 * sesli mesajda sabit bir metindir ("Sesli mesaj"); ikisi de ham gecirilirse model
 * bunlari karsi tarafin YAZDIGI metin sanip alakasiz cevap yazar — ya da URL'yi
 * taklit etmeye calisir ve cikti denetimine takilir. Etiketle gecirilince model
 * ne oldugunu bilir ve gormus gibi yapmaz.
 */
export function mesajMetni(m: MesajSatiri): string {
  if (m.audio_url) return '(sesli mesaj gönderdi)';
  if (m.is_image) return '(fotoğraf gönderdi)';
  const c = String(m.content ?? '');
  return c.startsWith(QUESTION_ONEKI) ? '(soru kartı)' : c;
}

/**
 * Yazma kapisi IKI kolonun birden dogru olmasidir. Discover `is_test_account` filtreliyor
 * (matching.service.ts:176), bot ise `is_seed_profile` hedefliyordu. Bugun ortusuyorlar
 * ama bunu zorlayan bir kisit yok: bir seed'de `is_test_account=false` yapilirsa profil
 * gercek kullanicilara acilir VE bot ona cevap yazmaya devam ederdi.
 */
function botYazabilir<T extends { is_seed_profile?: unknown; is_test_account?: unknown }>(
  u: T | null | undefined,
): u is T {
  return Boolean(u?.is_seed_profile) && Boolean(u?.is_test_account);
}

const KAPI_HATASI = 'alici seed profil degil (is_seed_profile + is_test_account)';

/**
 * Spec §5: faz 4'te bir kez nazik kapanis yazilir, sonrasinda yeni satir acilmaz.
 * Kapanis = sohbet FAZ4_ESIK mesaja ulastiktan SONRA yazilmis seed mesaji
 * (0-tabanli indeks >= FAZ4_ESIK, yani 26. mesaj ve sonrasi).
 */
async function kapanisGonderildi(matchId: string, seedId: string, mesajSayisi: number): Promise<boolean> {
  if (mesajSayisi <= FAZ4_ESIK) return false;
  const { data } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('match_id', matchId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .range(FAZ4_ESIK, mesajSayisi - 1);
  return (data ?? []).some((m) => m.sender_id === seedId);
}

/** Soru kotasi onden kontrol edilir: dolu iken satir acmak bos yere LLM cagrisi yakar. */
async function soruKotasiDolu(matchId: string, seedId: string): Promise<boolean> {
  const gunBasi = new Date();
  gunBasi.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('chat_questions')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('sender_id', seedId)
    .gte('created_at', gunBasi.toISOString());
  return (count ?? 0) >= GUNLUK_SORU_KOTASI;
}

async function seedEslesmeleri(seedIds: string[]) {
  const bulunan = new Map<string, { id: string; user1_id: string; user2_id: string }>();
  for (const kolon of ['user1_id', 'user2_id'] as const) {
    for (let i = 0; i < seedIds.length; i += ID_PARCA) {
      const { data } = await supabase
        .from('matches')
        .select('id, user1_id, user2_id')
        .eq('is_active', true)
        .in(kolon, seedIds.slice(i, i + ID_PARCA));
      for (const m of data ?? []) {
        bulunan.set(m.id as string, m as { id: string; user1_id: string; user2_id: string });
      }
    }
  }
  return [...bulunan.values()];
}

/**
 * Bekleyen medya istekleri, eslesme basina degil parcali tek sorguda (cron 10 sn'de doner).
 *
 * Hata FIRLATILIR, yutulmaz: bos donen bir sorgu "istek yok" gibi gorunur, bot metin
 * cevabi yazar ve istek sonsuza dek `pending` kalir — kapatmak icin yazdigimiz
 * kilitlenmenin ta kendisi. (Ayni sessiz-yutma deseni discover havuzunu 2026-09-17'de
 * herkes icin bosaltmisti.)
 */
async function bekleyenMedyaIstekleri(matchIdler: string[]) {
  const harita = new Map<string, { id: string; requester_id: string }>();
  for (let i = 0; i < matchIdler.length; i += ID_PARCA) {
    const { data, error } = await supabase
      .from('media_requests')
      .select('id, match_id, requester_id, created_at')
      .eq('status', 'pending')
      .in('match_id', matchIdler.slice(i, i + ID_PARCA))
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const r of data ?? []) {
      const mid = r.match_id as string;
      if (!harita.has(mid)) harita.set(mid, { id: r.id as string, requester_id: r.requester_id as string });
    }
  }
  return harita;
}

/** Kuyruk kaydi. UNIQUE ihlali (yaris) normaldir: baska instance ayni satiri acmistir. */
async function satirAc(alanlar: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('seed_reply_queue').insert({ status: 'pending', ...alanlar });
  return !error;
}

/** Aktif eslesmelerde son silinmemis mesaji insan atmis olanlari kuyruga alir. Eklenen satir sayisini doner. */
export async function scanAndEnqueue(now: Date = new Date(), rand: () => number = Math.random): Promise<number> {
  const { data: seedler } = await supabase
    .from('users')
    .select('id, seed_persona')
    .eq('is_seed_profile', true)
    .eq('is_test_account', true);
  if (!seedler?.length) return 0;

  const seedIds = seedler.map((u) => u.id as string);
  const seedIdSet = new Set(seedIds);
  const personaOf = new Map(
    seedler.map((u) => [u.id as string, (u.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA]),
  );

  const eslesmeler = await seedEslesmeleri(seedIds);
  if (!eslesmeler.length) return 0;

  const { data: acikSatirlar } = await supabase
    .from('seed_reply_queue')
    .select('match_id')
    .in('status', ['pending', 'claimed']);
  const acik = new Set((acikSatirlar ?? []).map((r) => r.match_id as string));

  // `failed`/`cancelled` satir acik-satir filtresine girmez, insanin mesaji ise hala son
  // mesajdir: soguma olmadan tarama HER tikte yeni satir acar ve her tur denetim dongusu
  // yuzunden 2 Gemini cagrisi yakar. `withinRateLimits` fren olamaz, cunku GONDERILMIS
  // mesajlari sayar — basarisiz satir hic mesaj yazmaz.
  const { data: kapaliSatirlar } = await supabase
    .from('seed_reply_queue')
    .select('match_id, trigger_message_id, question_id, media_request_id, status')
    .in('status', ['failed', 'cancelled'])
    .gte('updated_at', new Date(now.getTime() - SOGUMA_MS).toISOString());

  const sonHatali = new Set(
    (kapaliSatirlar ?? []).filter((r) => r.status === 'failed').map((r) => r.match_id as string),
  );
  // Iptal, eslesmeyi SUSTURMAZ: gunluk soru limiti gibi tamamen normal iptal sebepleri var.
  // Yalniz AYNI tetikleyicinin (mesaj ya da soru) tekrar kuyruga girmesi engellenir; 18 yas
  // alti beyani gibi kalici sebepler boylece sonsuz iptal dongusu kurmaz.
  const iptalTetikleyici = new Set(
    (kapaliSatirlar ?? [])
      .filter((r) => r.status === 'cancelled')
      .flatMap((r) => [r.trigger_message_id, r.question_id, r.media_request_id])
      .filter((v): v is string => typeof v === 'string'),
  );

  const fastMode = await fastModeAcik();
  const medyaIstegi = await bekleyenMedyaIstekleri(eslesmeler.map((m) => m.id as string));
  let eklenen = 0;

  for (const m of eslesmeler) {
    if (acik.has(m.id as string) || sonHatali.has(m.id as string)) continue;
    const user1 = m.user1_id as string;
    const user2 = m.user2_id as string;
    const seedId = seedIdSet.has(user1) ? user1 : seedIdSet.has(user2) ? user2 : null;
    if (!seedId) continue;

    /** Oncelikli satirlar (soru cevabi, medya reddi) faz 1 gecikmesiyle acilir. */
    const oncelikliAn = () => new Date(now.getTime() + computeReplyDelayMs({
      persona: personaOf.get(seedId)!, now, fastMode, phase: 1,
      messageCount: 0, msSinceLastExchange: null, rand,
    })).toISOString();

    // Bota sorulmus, cevaplanmamis soru varsa once onu cevapla (yoksa kilitli soruda sohbet olur).
    const { data: bekleyen } = await supabase
      .from('chat_questions')
      .select('id, sender_id, answered_option, is_abandoned')
      .eq('match_id', m.id)
      .is('answered_option', null)
      .eq('is_abandoned', false)
      .limit(1);
    const soru = bekleyen?.[0];
    if (soru && soru.sender_id !== seedId) {
      if (iptalTetikleyici.has(soru.id as string)) continue;
      if (await satirAc({
        match_id: m.id, seed_user_id: seedId, question_id: soru.id,
        kind: 'question_answer', reply_due_at: oncelikliAn(),
      })) eklenen += 1;
      continue;
    }

    // Bekleyen medya istegi: cevapsiz kalirsa KALICI kilitlenme — `requestMedia`
    // bekleyen istek varken MEDIA_REQUEST_PENDING firlatir ve isteklerin timeout'u
    // yoktur, yani kullanici o eslesmede bir daha foto/ses gonderemez.
    const medya = medyaIstegi.get(m.id as string);
    if (medya && medya.requester_id !== seedId) {
      if (iptalTetikleyici.has(medya.id)) continue;
      if (await satirAc({
        match_id: m.id, seed_user_id: seedId, media_request_id: medya.id,
        kind: 'media_request', reply_due_at: oncelikliAn(),
      })) eklenen += 1;
      continue;
    }

    // Son SILINMEMIS mesaj: silinmis mesaja cevap yazmak hem urkutucu hem "silinen icerik okundu" sinyali.
    const { data: sonMesajlar } = await supabase
      .from('messages')
      .select('id, sender_id, content, created_at')
      .eq('match_id', m.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const son = sonMesajlar?.[0];
    if (!son || son.sender_id === seedId) continue;
    if (typeof son.content === 'string' && son.content.startsWith(QUESTION_ONEKI)) continue;
    if (iptalTetikleyici.has(son.id as string)) continue;

    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', m.id)
      .is('deleted_at', null);
    const mesajSayisi = count ?? 0;
    const faz = fazFor(mesajSayisi);

    if (faz === 4 && (await kapanisGonderildi(m.id as string, seedId, mesajSayisi))) continue;

    // Spec §6.1: soru, metin cevabinin YERINE gecer — ikisi ayni anda gonderilmez.
    const faz1SonUcteBir = faz === 1 && mesajSayisi >= FAZ1_SON_UCTE_BIR;
    const soruSirasi = faz1SonUcteBir
      && rand() < SORU_OLASILIGI
      && !(await soruKotasiDolu(m.id as string, seedId));

    const gecikme = computeReplyDelayMs({
      persona: personaOf.get(seedId)!,
      now, fastMode, phase: faz,
      messageCount: mesajSayisi, msSinceLastExchange: null, rand,
    });

    if (await satirAc({
      match_id: m.id, seed_user_id: seedId,
      // Soru bir insan mesajinin cevabi DEGIL: trigger_message_id NULL kalir, boylece
      // iptal edilirse ayni mesajin metin cevabi soguma filtresine takilmaz.
      trigger_message_id: soruSirasi ? null : son.id,
      kind: soruSirasi ? 'question' : 'message',
      reply_due_at: new Date(now.getTime() + gecikme).toISOString(),
    })) eklenen += 1;
  }
  return eklenen;
}

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
async function backoffVeyaBitir(row: QueueRow, hata: string): Promise<'deferred' | 'failed'> {
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

const KRIZ = /(yaşamak istemiyorum|intihar|kendime zarar|canıma kıy|ölmek istiyorum|yaşamaktan bıktım)/i;

/**
 * Karsi taraf konusmayi kapatiyor mu. Turkce ekler yuzunden kok bitislerinde `\b` YOK
 * (platform regex'inde ayni tuzaga dusulmustu: "telegramdan" filtreden kaciyordu).
 * Canli kusur: "uyuyayim ben biraz" -> bot "dinlen uykunu al, gunun nasil gecti peki".
 */
const KAPANIS = /\b(iyi geceler|görüşürüz|gorusuruz|hoşça ?kal|hoscakal|kapatıyorum|uyuyay|uyuyorum|uyuycam|uyucam|yatıyorum|yatıyom|yatacağım|yatcam|sonra konuşuruz|sonra yazarım|ben kaçtım|kaçtım ben|çıkmam lazım|gitmem lazım)/i;

export function kapanisSinyali(text: string): boolean {
  return KAPANIS.test(text);
}
const YAS_ALTI = /\b(1[0-7])\s*yaş(ında|ındayım)?\b/i;
const KRIZ_CEVABI =
  'ya böyle yazınca içim cız etti. ciddiyim, bunu tek başına taşıma — 112\'yi arayabilirsin ya da yakınındaki birine söyle. ben buradayım ama bu konuda gerçekten yardım alman lazım.';

const GECMIS_LIMIT = 20;

/**
 * Bot bir sey yazdi: cevrimici bayragi ve son gorulme BIRLIKTE tazelenir.
 * Yalniz `last_seen_at` yazilirsa sohbet basliginda "cevrimdisi" gorunurken
 * saniyeler icinde cevap gelir — celiskinin ta kendisi. Bir sonraki presence
 * tikinde (en fazla 5 dk) profil dogal ritmine doner.
 */
async function aktifIsaretle(seedUserId: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_online: true, last_seen_at: new Date().toISOString() })
    .eq('id', seedUserId);
  if (error) console.warn('[SeedReply] presence yazilamadi:', error.message);
}

/** Persona karti icin gereken seed alanlari; `personaGirdisi` ile ayni sozlesme. */
type SeedSatiri = SeedProfilSatiri & { seed_persona?: unknown };

interface SeedBaglami {
  sistem: string;
  turns: Array<{ role: 'model' | 'user'; text: string }>;
  /** Son INSAN mesajinin LLM'e giden hali; yas ve kriz kapilari bunun uzerinde calisir. */
  sonInsanMetni: string;
}

/**
 * Bir satir icin LLM baglamini kurar: persona karti + kirpilmis sohbet gecmisi.
 * Metin cevabi ve medya gecistirmesi AYNI baglami kullanir; ayrildiklari yer
 * uretim POLITIKASI (uyari-probe'lu iki deneme vs tek deneme), baglam degil.
 */
async function seedBaglami(
  row: QueueRow,
  seed: SeedSatiri,
  opts: { mediaAsk?: boolean } = {},
): Promise<SeedBaglami> {
  const [detaySonuc, sayim, gecmisSonuc] = await Promise.all([
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
  ]);

  // Gecmis sessizce bos donerse model SIFIR baglamla yazar ve o cevap gonderilir.
  if (gecmisSonuc.error) throw gecmisSonuc.error;

  const gecmis = (gecmisSonuc.data ?? []).slice().reverse();
  const sonInsan = [...gecmis].reverse().find((m) => m.sender_id !== row.seed_user_id);
  // Medya etiketli: yas/kriz/kapanis desenleri bir storage URL'sinde aranmaz.
  const sonInsanMetni = sonInsan ? mesajMetni(sonInsan) : '';

  const persona = (seed.seed_persona as SeedPersona | null) ?? VARSAYILAN_PERSONA;
  const sistem = buildPersonaCard(personaGirdisi(seed, detaySonuc.data ?? null, {
    persona,
    phase: fazFor(sayim.count ?? 0),
    busyNow: isBusy(persona, new Date()),
    // Medya istegi kendi baglamini tasir; ikisi ayni promptta celisirdi.
    partnerClosing: !opts.mediaAsk && kapanisSinyali(sonInsanMetni),
    mediaAsk: opts.mediaAsk,
  }));

  const turns = gecmis.map((m) => ({
    role: (m.sender_id === row.seed_user_id ? 'model' : 'user') as 'model' | 'user',
    text: mesajMetni(m),
  }));
  if (opts.mediaAsk) turns.push({ role: 'user' as const, text: MEDYA_ISTEGI_ETIKETI });

  return { sistem, turns, sonInsanMetni };
}

function hataKodu(err: unknown): string {
  return String((err as { code?: string })?.code ?? (err as Error)?.message ?? '');
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
  const { data: seed } = await supabase
    .from('users')
    .select('id, name, age, city, bio, gender, interests, relationship_goal, is_seed_profile, is_test_account, seed_persona')
    .eq('id', row.seed_user_id)
    .maybeSingle();
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  const { sistem, turns, sonInsanMetni } = await seedBaglami(row, seed);

  if (YAS_ALTI.test(sonInsanMetni)) {
    await markCancelled(row.id, '18 yas alti beyani');
    return 'cancelled';
  }

  let metin: string | null = null;

  if (KRIZ.test(sonInsanMetni)) {
    metin = KRIZ_CEVABI; // Rolu birak; bu cevap LLM'den GECMEZ.
  } else {
    for (let deneme = 0; deneme < 2 && metin === null; deneme += 1) {
      const sistemProbe = deneme === 0
        ? sistem
        : `${sistem}\n\n# UYARI\nBir onceki cevabin kurallari cignedi. Cok kisa yaz, iletisim bilgisi verme, liste yapma.`;
      let ham: string;
      try {
        ham = (await generateSeedReply({ system: sistemProbe, turns })).text;
      } catch (err) {
        return backoffVeyaBitir(row, `llm: ${hataKodu(err)}`);
      }
      const denetim = validateReply(ham, sistem);
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
  const { data: seed } = await supabase
    .from('users').select('id, name, age, city, bio, is_seed_profile, is_test_account, seed_persona')
    .eq('id', row.seed_user_id).maybeSingle();
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  const { data: detay } = await supabase
    .from('user_details').select('job, personality, pets, music_type').eq('user_id', row.seed_user_id).maybeSingle();

  const talimat = [
    `Sen ${seed.name}'sin. Meslegin: ${detay?.job ?? 'bilinmiyor'}. Profil metnin: "${seed.bio ?? ''}".`,
    'Eslestigin kisiye KENDIN hakkinda 4 sikli bir tahmin sorusu hazirla. Dogru sik GERCEKTEN dogru olmali.',
    'Yalniz JSON dondur, baska hicbir sey yazma:',
    '{"question_text":"...","option_count":4,"option_a":"...","option_b":"...","option_c":"...","option_d":"...","correct_option":"A|B|C|D"}',
  ].join('\n');

  let ham: string;
  try {
    ham = (await generateSeedReply({ system: talimat, turns: [{ role: 'user', text: 'soruyu hazirla' }] })).text;
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
  const { data: seed } = await supabase
    .from('users').select('id, is_seed_profile, is_test_account').eq('id', row.seed_user_id).maybeSingle();
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
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

// --- respondMediaRequest: foto/ses paylasim istegi (Task 060) ----------------

/** Medya istegi bir mesaj degil, bir eylem: gecmise `mesajMetni` ile ayni dilde girer. */
const MEDYA_ISTEGI_ETIKETI = '(fotoğraf ve sesli mesaj paylaşımını açmak istedi)';

/**
 * Reddin ardindan sohbete yazilan tek cumlelik gecistirme. Best-effort:
 * uretilemezse sessiz kalinir — hazir kalip yazmak kalip tekrarina yol acar ve
 * botu ele veren en buyuk kaynak odur (bkz. processRow'daki ayni karar).
 *
 * `processRow`'dan tek farki uretim politikasi: orada uyari-probe'lu iki deneme
 * + backoff var, burada tek deneme. Ret zaten yapildigi icin satirin isi bitmistir;
 * CHAT_LOCKED dahil gonderim hatalari da yutulur — yeniden denemek reddi
 * tekrarlamak demek olurdu ve kullanici reddi zaten arayuzde gorur.
 */
async function medyaGecistirmesiYaz(row: QueueRow, seed: SeedSatiri): Promise<void> {
  let baglam: SeedBaglami;
  try {
    baglam = await seedBaglami(row, seed, { mediaAsk: true });
  } catch (err) {
    console.warn('[SeedReply] medya baglami kurulamadi:', hataKodu(err));
    return;
  }

  // 18 yas alti beyani / kriz: ret YAPILIR (guvenli taraf) ama flort dilinde
  // gecistirme YAZILMAZ. Metin satiri bu sebeple iptal edilmis olsa bile medya
  // istegi AYRI bir tetikleyicidir (farkli id) ve iptal filtresine takilmaz —
  // kapi bu yolda ayrica kurulmali.
  if (YAS_ALTI.test(baglam.sonInsanMetni) || KRIZ.test(baglam.sonInsanMetni)) {
    console.warn(`[SeedReply] medya gecistirmesi yazilmadi (yas/kriz kapisi) match=${row.match_id}`);
    return;
  }

  let ham: string;
  try {
    ham = (await generateSeedReply({ system: baglam.sistem, turns: baglam.turns })).text;
  } catch (err) {
    console.warn('[SeedReply] medya gecistirmesi uretilemedi:', hataKodu(err));
    return;
  }

  const denetim = validateReply(ham, baglam.sistem);
  if (!denetim.ok) {
    console.warn(`[SeedReply] medya gecistirmesi elendi (${denetim.reason}) match=${row.match_id}`);
    return;
  }

  try {
    await chatService.sendMessage(row.seed_user_id, row.match_id, denetim.text);
  } catch (err) {
    console.warn('[SeedReply] medya gecistirmesi gonderilemedi:', hataKodu(err));
  }
}

/**
 * Bota acilan foto/ses paylasim istegini cevaplar: istek REDDEDILIR, ardindan
 * sohbete kisa ve nazik bir gecistirme yazilir.
 *
 * Neden kabul degil ret: bot medya GONDEREMEZ (`chatService.sendMessage` yalniz metin
 * alir). Kabul edilseydi karsi taraf foto atar, "sen de at" der, bot verdigi sozu
 * tutamazdi — botu ele veren en net durum. Ret, bir flort uygulamasinda siradan bir
 * davranistir ve asil sorunu da cozer.
 *
 * Sira onemli: ONCE reddet, SONRA yaz. Reddetmek kilitlenmeyi acan asil istir
 * (bekleyen istek varken `requestMedia` MEDIA_REQUEST_PENDING firlatir, timeout yok);
 * metin uretilemezse sessiz ret kalir. Tersi sirada bot "istemiyorum" yazip istegi
 * pending birakabilirdi.
 */
export async function respondMediaRequest(row: QueueRow): Promise<IslemSonucu> {
  // Kimlik cift kontrolu — diger yazma yollariyla AYNI kapi.
  const { data: seed } = await supabase
    .from('users')
    .select('id, name, age, city, bio, gender, interests, relationship_goal, is_seed_profile, is_test_account, seed_persona')
    .eq('id', row.seed_user_id).maybeSingle();
  if (!botYazabilir(seed)) {
    await markCancelled(row.id, KAPI_HATASI);
    return 'cancelled';
  }

  if (!row.media_request_id) {
    await markCancelled(row.id, 'media_request_id yok');
    return 'cancelled';
  }

  if (!(await withinRateLimits(row.match_id, row.seed_user_id))) {
    await deferRow(row.id, 30 * 60_000);
    return 'deferred';
  }

  const { data: istek } = await supabase
    .from('media_requests').select('id, match_id, status, requester_id')
    .eq('id', row.media_request_id).maybeSingle();
  // `match_id` esitligi: ret istegin eslesmesinde uygulanirken gecistirme
  // `row.match_id`'ye yaziliyor — ikisi ayrilirsa bot baska bir sohbete yazar.
  if (!istek || istek.status !== 'pending' ||
      istek.requester_id === row.seed_user_id || istek.match_id !== row.match_id) {
    await markCancelled(row.id, 'medya istegi cevaplanabilir durumda degil');
    return 'cancelled';
  }

  try {
    await mediaService.respondToRequest(row.media_request_id, row.seed_user_id, 'reject');
  } catch (err) {
    const kod = hataKodu(err);
    if (kod.includes('NOT_MATCHED') || kod.includes('MATCH_INACTIVE') ||
        kod.includes('MEDIA_REQUEST_NOT_FOUND') || kod.includes('MEDIA_REQUEST_NOT_RECIPIENT')) {
      await markCancelled(row.id, kod);
      return 'cancelled';
    }
    return backoffVeyaBitir(row, `medya reddi: ${kod}`);
  }

  await aktifIsaretle(row.seed_user_id);
  await medyaGecistirmesiYaz(row, seed);
  await markSent(row.id);
  return 'sent';
}
