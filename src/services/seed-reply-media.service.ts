import { supabase } from '../config/supabase.js';
import { chatService } from './chat.service.js';
import { generateSeedReply } from './seed-llm.service.js';
import { validateReply } from './seed-reply-guard.js';
import { mediaService } from './media.service.js';
import {
  seedBaglami, hataKodu, botYazabilir, KAPI_HATASI, KRIZ, YAS_ALTI,
  markCancelled, markSent, deferRow, withinRateLimits, backoffVeyaBitir, aktifIsaretle,
  type QueueRow, type IslemSonucu, type SeedSatiri, type SeedBaglami,
} from './seed-reply.service.js';

/**
 * Seed AI: bota acilan foto/ses paylasim istegine cevap (Task 060, migration 060).
 * seed-reply.service.ts'ten ayrildi (2026-09-27); ortak cekirdegi (baglam, kimlik kapisi,
 * durum gecisleri) oradan alir. Yon tek: servis bu modulu import ETMEZ (dongusel import yok).
 */

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
