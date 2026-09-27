import { supabase } from '../config/supabase.js';
import { computeReplyDelayMs, fazFor, VARSAYILAN_PERSONA } from './seed-reply-timing.js';
import type { SeedPersona } from '../types/seed-persona.js';

/**
 * Seed AI cevap TARAMASI: insandan tetikleyicisi olan seed eslesmelerini `seed_reply_queue`'ya
 * alir. Kuyruk ISLEME (processRow, askQuestion, ...) seed-reply.service.ts'te; ikisi yalniz kuyruk
 * satiri uzerinden konusur. 2026-09-27'de ayrildi (servis ~800 satir; tarama tek RPC'ye inmisti).
 */

/** Kalici basarisizliktan sonra ayni eslesmeye yeniden satir acmadan once beklenen sure. */
const SOGUMA_MS = 6 * 60 * 60_000;

/** Spec §6.1: faz 1'in son ucte biri (7-10. mesaj), %30 ihtimalle soru. */
const FAZ1_SON_UCTE_BIR = 7;
const SORU_OLASILIGI = 0.3;
/** Ucretsiz kademe: eslesme basina gunde 2 soru (chat-question.service.ts:258). */
const GUNLUK_SORU_KOTASI = 2;

/**
 * fazFor bu sayidan itibaren 4 doner. Spec §5: faz 4'te bir kez nazik kapanis yazilir,
 * sonrasinda yeni satir acilmaz. Kapanis = sohbet bu esige ulastiktan SONRA yazilmis seed
 * mesaji (0-tabanli indeks >= FAZ4_ESIK, yani 26. mesaj ve sonrasi) — aday RPC'sine verilir.
 */
const FAZ4_ESIK = 25;

async function fastModeAcik(): Promise<boolean> {
  const { data } = await supabase.from('app_config').select('seed_reply_fast_mode').limit(1).maybeSingle();
  return Boolean(data?.seed_reply_fast_mode);
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

/**
 * `seed_reply_candidates` RPC satiri (migration 065 + 066): aksiyon bekleyebilecek seed
 * eslesmesinin gercekleri. SQL yalniz aktif, seed tarafi `is_seed_profile` +
 * `is_test_account` olan, ACIK kuyruk satiri olmayan ve insandan gelen bir tetikleyicisi
 * (cevapsiz soru, bekleyen medya istegi ya da kapanis oncesi son mesaj) bulunan
 * eslesmeleri dondurur; karar (tur, soguma, iptal, soru zari) asagida JS'te.
 * SQL senaryo sinamasi: scripts/sql-checks/seed-reply-candidates.ts
 */
export interface SeedAdayi {
  match_id: string;
  seed_user_id: string;
  seed_persona: SeedPersona | null;
  /** Silinmemis mesaj sayisi (faz). */
  message_count: number;
  /** Son SILINMEMIS mesaj. */
  last_message_id: string | null;
  last_message_sender_id: string | null;
  /** Son mesaj `__QUESTION__:` soru karti isareti mi. */
  last_message_is_question: boolean;
  /** Seed, FAZ4_ESIK'ten sonra (kapanis) mesaj yazmis mi. */
  kapanis_gonderildi: boolean;
  /** INSANIN en eski cevaplanmamis, terk edilmemis sorusu (botun kendi sorusu donmez — 066). */
  pending_question_id: string | null;
  pending_question_sender_id: string | null;
  /** INSANIN en yeni `pending` medya istegi (botunki donmez — 066). */
  pending_media_request_id: string | null;
  pending_media_requester_id: string | null;
}

/**
 * Adaylar TEK istekte. Eskiden her 10 sn'lik tik 417 seed id'sini 100'luk parcalarla iki
 * kolonda arayip (10 istek) eslesme basina mesaj + soru okuyordu (N+1): tik basina ~39
 * istek, gunde ~337 bin — neredeyse hepsi "is yok" sonucu icin (2026-09-27).
 *
 * Hata FIRLATILIR, yutulmaz: bos donen bir sorgu "aday yok" gibi gorunur ve botlar sessizce
 * susar; bekleyen medya istegi de sonsuza dek `pending` kalir (kilitlenme). Ayni sessiz-yutma
 * deseni discover havuzunu 2026-09-17'de herkes icin bosaltmisti.
 */
async function seedAdaylari(): Promise<SeedAdayi[]> {
  const { data, error } = await supabase.rpc('seed_reply_candidates', { p_kapanis_esik: FAZ4_ESIK });
  if (error) throw error;
  return (data ?? []) as SeedAdayi[];
}

/** Kuyruk kaydi. UNIQUE ihlali (yaris) normaldir: baska instance ayni satiri acmistir. */
async function satirAc(alanlar: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from('seed_reply_queue').insert({ status: 'pending', ...alanlar });
  return !error;
}

/**
 * Insandan gelen tetikleyicisi olan seed eslesmelerini kuyruga alir. Eklenen satir sayisini doner.
 * Bostaki tik (aday yok) tek istektir: RPC. Kapali satirlar ve hizli mod yalniz aday varsa okunur.
 */
export async function scanAndEnqueue(now: Date = new Date(), rand: () => number = Math.random): Promise<number> {
  const adaylar = await seedAdaylari();
  if (!adaylar.length) return 0;

  // `failed`/`cancelled` satir acik-satir filtresine girmez, insanin mesaji ise hala son
  // mesajdir: soguma olmadan tarama HER tikte yeni satir acar ve her tur denetim dongusu
  // yuzunden 2 Gemini cagrisi yakar. `withinRateLimits` fren olamaz, cunku GONDERILMIS
  // mesajlari sayar — basarisiz satir hic mesaj yazmaz. Hata FIRLATILIR: yutulursa iki filtre
  // bos kalir ve iptal edilmis tetikleyici (18 yas alti) de kuyruga geri girer.
  const { data: kapaliSatirlar, error: kapaliHata } = await supabase
    .from('seed_reply_queue')
    .select('match_id, trigger_message_id, question_id, media_request_id, status')
    .in('status', ['failed', 'cancelled'])
    .gte('updated_at', new Date(now.getTime() - SOGUMA_MS).toISOString());
  if (kapaliHata) throw kapaliHata;

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

  // Hizli mod yalniz satir acilacaksa okunur: soguma/iptal yuzunden bekleyen aday her tikte
  // gereksiz istek atmasin.
  let fastMode: boolean | null = null;
  const baglam: TaramaBaglami = {
    now, rand, sonHatali, iptalTetikleyici,
    hizliMod: async () => (fastMode ??= await fastModeAcik()),
  };

  let eklenen = 0;
  for (const a of adaylar) {
    // Tek adayin hatasi (ör. bozuk persona → gecikme hesabi TypeError) digerlerini durdurmaz;
    // eskiden tum tarama her tikte dusuyor ve diger sohbetler hic kuyruga giremiyordu.
    try {
      if (await adayiKuyrugaAl(a, baglam)) eklenen += 1;
    } catch (err) {
      console.error(`[SeedReply] aday islenemedi match=${a.match_id}:`, err instanceof Error ? err.message : err);
    }
  }
  return eklenen;
}

interface TaramaBaglami {
  now: Date;
  rand: () => number;
  sonHatali: Set<string>;
  iptalTetikleyici: Set<string>;
  hizliMod: () => Promise<boolean>;
}

/** Tek adaya satir acar (acildiysa true). Dal onceligi: insanin sorusu > medya istegi > son mesaj. */
async function adayiKuyrugaAl(a: SeedAdayi, b: TaramaBaglami): Promise<boolean> {
  if (b.sonHatali.has(a.match_id)) return false;
  const seedId = a.seed_user_id;
  const persona = a.seed_persona ?? VARSAYILAN_PERSONA;

  /** Oncelikli satirlar (soru cevabi, medya reddi) faz 1 gecikmesiyle acilir. */
  const oncelikliAn = async () => new Date(b.now.getTime() + computeReplyDelayMs({
    persona, now: b.now, fastMode: await b.hizliMod(), phase: 1,
    messageCount: 0, msSinceLastExchange: null, rand: b.rand,
  })).toISOString();

  // Bota sorulmus, cevaplanmamis soru varsa once onu cevapla (yoksa kilitli soruda sohbet olur).
  if (a.pending_question_id && a.pending_question_sender_id !== seedId) {
    if (b.iptalTetikleyici.has(a.pending_question_id)) return false;
    return satirAc({
      match_id: a.match_id, seed_user_id: seedId, question_id: a.pending_question_id,
      kind: 'question_answer', reply_due_at: await oncelikliAn(),
    });
  }

  // Bekleyen medya istegi: cevapsiz kalirsa KALICI kilitlenme — `requestMedia`
  // bekleyen istek varken MEDIA_REQUEST_PENDING firlatir ve isteklerin timeout'u
  // yoktur, yani kullanici o eslesmede bir daha foto/ses gonderemez.
  if (a.pending_media_request_id && a.pending_media_requester_id !== seedId) {
    if (b.iptalTetikleyici.has(a.pending_media_request_id)) return false;
    return satirAc({
      match_id: a.match_id, seed_user_id: seedId, media_request_id: a.pending_media_request_id,
      kind: 'media_request', reply_due_at: await oncelikliAn(),
    });
  }

  // Son SILINMEMIS mesaj (SQL'de): silinmis mesaja cevap yazmak hem urkutucu hem
  // "silinen icerik okundu" sinyali.
  if (!a.last_message_id || a.last_message_sender_id === seedId) return false;
  if (a.last_message_is_question) return false;
  if (b.iptalTetikleyici.has(a.last_message_id)) return false;
  if (a.kapanis_gonderildi) return false;

  const mesajSayisi = a.message_count;
  const faz = fazFor(mesajSayisi);

  // Spec §6.1: soru, metin cevabinin YERINE gecer — ikisi ayni anda gonderilmez.
  const faz1SonUcteBir = faz === 1 && mesajSayisi >= FAZ1_SON_UCTE_BIR;
  const soruSirasi = faz1SonUcteBir
    && b.rand() < SORU_OLASILIGI
    && !(await soruKotasiDolu(a.match_id, seedId));

  const gecikme = computeReplyDelayMs({
    persona, now: b.now, fastMode: await b.hizliMod(), phase: faz,
    messageCount: mesajSayisi, msSinceLastExchange: null, rand: b.rand,
  });

  return satirAc({
    match_id: a.match_id, seed_user_id: seedId,
    // Soru bir insan mesajinin cevabi DEGIL: trigger_message_id NULL kalir, boylece
    // iptal edilirse ayni mesajin metin cevabi soguma filtresine takilmaz.
    trigger_message_id: soruSirasi ? null : a.last_message_id,
    kind: soruSirasi ? 'question' : 'message',
    reply_due_at: new Date(b.now.getTime() + gecikme).toISOString(),
  });
}
