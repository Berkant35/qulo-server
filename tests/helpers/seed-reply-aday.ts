import type { SeedAdayi } from '../../src/services/seed-reply.service.js';

/**
 * `seed_reply_candidates` RPC satiri (migration 065) — TUM kolonlariyla; eksik kolonlu
 * sahte satir, uretimde okunan bir alani testte sessizce `undefined` birakirdi.
 * Varsayilan: insanin tek mesajina cevap bekleyen, bekleyen soru/medya istegi olmayan eslesme.
 */
export function seedAdayi(
  kimlik: { match_id: string; seed_user_id: string; insan: string },
  over: Partial<SeedAdayi> = {},
): SeedAdayi {
  return {
    match_id: kimlik.match_id,
    seed_user_id: kimlik.seed_user_id,
    seed_persona: null,
    message_count: 1,
    last_message_id: 'm1',
    last_message_sender_id: kimlik.insan,
    last_message_is_question: false,
    kapanis_gonderildi: false,
    pending_question_id: null,
    pending_question_sender_id: null,
    pending_media_request_id: null,
    pending_media_requester_id: null,
    ...over,
  };
}
