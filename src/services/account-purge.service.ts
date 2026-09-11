import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";

/** Storage `list` varsayilani 100 dosya; sohbet klasorleri sayfa sayfa bosaltilir. */
const CHAT_MEDIA_PAGE_SIZE = 1000;
/** Silme sessizce tutmazsa (hep ayni sayfa donerse) sonsuz donguye girmesin. */
const CHAT_MEDIA_MAX_PAGES = 50;

/**
 * Soft-delete edilmis bir hesabi ve tum iliskili verisini kalici olarak siler —
 * e-posta ya da sosyal kimlik yeniden kayit icin serbest kalsin.
 *
 * Cagiranlar kimlik akislari: e-posta kaydi ve sosyal giris (Case A/B). Kalici veri
 * silme kendi alani oldugu icin auth.service'ten ayrildi; tablo listesi tek yerde.
 */
class AccountPurgeService {
  /**
   * Hard-delete a soft-deleted user and all related data so the email can be re-registered.
   */
  async hardDeleteUser(userId: string) {
    assertUuid(userId, 'userId');
    // Savunma: yalnizca soft-delete edilmis hesap kalici silinir. Servis public;
    // yanlis bir cagiran aktif bir hesabi geri donussuz silemesin.
    const { data: target, error: readError } = await supabase
      .from("users")
      .select("is_deleted")
      .eq("id", userId)
      .maybeSingle();
    if (readError || target?.is_deleted !== true) {
      console.error("[hardDelete] Refused: user is not soft-deleted", { userId });
      throw Errors.SERVER_ERROR();
    }

    // Eslesme id'leri silmeden ONCE alinir: sohbet medyasi `chat-media/${matchId}/` altinda.
    // Okunamazsa hicbir sey silinmeden durulur — devam edilse id'ler kaybolur ve medya
    // herkese acik bucket'ta kalici sahipsiz kalirdi. Bedeli: o kayit denemesi hata verir.
    const { data: userMatches, error: matchError } = await supabase
      .from("matches")
      .select("id")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`);
    if (matchError) {
      console.error("[hardDelete] Failed to read matches for chat-media cleanup:", matchError.message);
      throw Errors.SERVER_ERROR();
    }
    const matchIds = (userMatches ?? []).map((m: { id: string }) => m.id);

    // Delete from child tables first (order matters for FK constraints)
    // Quiz answers are deleted explicitly before their sessions (no FK cascade assumed)
    // Delete deepest children first to avoid FK violations
    const { data: sessions } = await supabase
      .from("quiz_sessions")
      .select("id")
      .or(`solver_id.eq.${userId},target_id.eq.${userId}`);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id);
      // Delete quiz_answers that belong to these sessions
      for (const sid of sessionIds) {
        await supabase.from("quiz_answers").delete().eq("session_id", sid);
      }
      // Now delete the sessions themselves
      for (const sid of sessionIds) {
        await supabase.from("quiz_sessions").delete().eq("id", sid);
      }
    }

    const childTables: { table: string; column: string }[] = [
      { table: "campaign_events", column: "user_id" },
      { table: "notifications", column: "user_id" },
      { table: "message_reactions", column: "user_id" },
      { table: "messages", column: "sender_id" },
      { table: "chat_questions", column: "sender_id" },
      { table: "media_requests", column: "requester_id" },
      { table: "matches", column: "user1_id" },
      { table: "matches", column: "user2_id" },
      { table: "swipes", column: "swiper_id" },
      { table: "swipes", column: "target_id" },
      { table: "diamond_transactions", column: "user_id" },
      { table: "power_purchase_transactions", column: "user_id" },
      { table: "user_power_inventory", column: "user_id" },
      { table: "iap_transactions", column: "user_id" },
      { table: "user_subscriptions", column: "user_id" },
      { table: "questions", column: "user_id" },
      { table: "reports", column: "reporter_id" },
      { table: "reports", column: "reported_id" },
      { table: "referrals", column: "referrer_id" },
      { table: "referrals", column: "referee_id" },
      { table: "user_languages", column: "user_id" },
      { table: "user_details", column: "user_id" },
      { table: "user_consents", column: "user_id" },
      { table: "refresh_tokens", column: "user_id" },
    ];

    for (const { table, column } of childTables) {
      const { error } = await supabase.from(table).delete().eq(column, userId);
      if (error) {
        // Table may not exist yet — log and continue
        console.warn(`[hardDelete] Failed to clean ${table}.${column}:`, error.message);
      }
    }

    // Delete photos from storage
    const { data: files } = await supabase.storage.from("photos").list(userId);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${userId}/${f.name}`);
      await supabase.storage.from("photos").remove(paths);
    }

    // Finally delete the user row
    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) {
      console.error("[hardDelete] Failed to delete user row:", error.message);
      throw Errors.SERVER_ERROR();
    }

    // Sohbet medyasi ancak kullanici satiri silindikten SONRA: FK CASCADE eslesmelerin ve
    // mesajlarin gercekten gittigini garanti ediyor. Once silinseydi, eslesme silmesi
    // patladiginda karsi taraf hala duran sohbette kirik medya gorurdu.
    await this.removeChatMedia(matchIds);

    console.log(`[hardDelete] User ${userId} fully purged`);
  }

  /**
   * Kullanicinin eslesmelerinin sohbet medyasini siler. Eslesme silinince mesajlari da
   * CASCADE ile gider (messages.match_id); dosyalar herkese acik bucket'ta sahipsiz
   * kalirdi. Karsi tarafin o sohbette gonderdigi medya da silinir — sohbetin kendisi yok.
   * Bir klasordeki hata digerlerini durdurmaz.
   */
  private async removeChatMedia(matchIds: string[]) {
    for (const matchId of matchIds) {
      for (let page = 0; page < CHAT_MEDIA_MAX_PAGES; page++) {
        const { data: media, error } = await supabase.storage
          .from("chat-media")
          .list(matchId, { limit: CHAT_MEDIA_PAGE_SIZE });
        if (error) {
          console.warn(`[hardDelete] Failed to list chat-media/${matchId}:`, error.message);
          break;
        }
        if (!media || media.length === 0) break;

        const { error: removeError } = await supabase.storage
          .from("chat-media")
          .remove(media.map((f) => `${matchId}/${f.name}`));
        if (removeError) {
          console.warn(`[hardDelete] Failed to clean chat-media/${matchId}:`, removeError.message);
          break;
        }
        if (media.length < CHAT_MEDIA_PAGE_SIZE) break;
      }
    }
  }
}

export const accountPurgeService = new AccountPurgeService();
