import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";
import { appConfigService } from "./app-config.service.js";
import { blockService } from "./block.service.js";

/** Discover gösteriminin LIKE / quiz/start kapısını açık tuttuğu süre (gün); cron daha eskiyi siler. */
export const SERVED_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;

const cutoffIso = () => new Date(Date.now() - SERVED_WINDOW_DAYS * DAY_MS).toISOString();

/**
 * Gösterim kapısı (spec 2026-10-06, kehanet açığı). Bilinen bir UUID'ye doğrudan API ile LIKE ya da
 * quiz/start yalnız Discover'ın son 30 günde izleyiciye gösterdiği ya da izleyicinin önceden
 * etkileştiği (LIKE / eşleşme / quiz) hedefe açıktır. Kapanan her durum var olmayan hedefle aynı
 * yanıtı (404 USER_NOT_FOUND) verir: 403/200 farkından hedefin cinsiyet tercihi okunamaz.
 *
 * REJECT kapıdan geçmez (yan etkisiz), bu yüzden yalnız REJECT satırı kapı AÇMAZ — açsaydı
 * rastgele UUID'yi önce REJECT edip kapı dolanılırdı.
 */
class ServedGateService {
  /** Discover sayfasındaki (≤10) kartları tek upsert ile yazar. Hata Discover'ı bozmaz. */
  async recordServed(viewerId: string, targetIds: readonly string[]): Promise<void> {
    if (targetIds.length === 0) return;
    const servedAt = new Date().toISOString();
    try {
      const { error } = await supabase
        .from("discover_served")
        .upsert(
          targetIds.map((targetId) => ({ viewer_id: viewerId, target_id: targetId, served_at: servedAt })),
          { onConflict: "viewer_id,target_id" },
        );
      if (error) console.error("[served-gate] gosterim yazilamadi:", error.code ?? "kod yok");
    } catch (err) {
      console.error("[served-gate] gosterim yazilamadi:", err instanceof Error ? err.name : "bilinmeyen");
    }
  }

  /**
   * LIKE swipe ve quiz/start'ta self kontrolünden sonra, her yan etkiden önce çağrılır.
   * Engel (iki yön) her zaman kapatır; anahtar açıkken gösterim/etkileşim de aranır.
   */
  async assertReachable(viewerId: string, targetId: string): Promise<void> {
    assertUuid(viewerId, "viewerId");
    assertUuid(targetId, "targetId");

    const enabled = await appConfigService.getServedGateEnabled();
    const [blocked, served] = await Promise.all([
      blockService.isBlocked(viewerId, targetId),
      enabled ? this.servedRecently(viewerId, targetId) : Promise.resolve(true),
    ]);
    if (blocked) throw Errors.USER_NOT_FOUND();
    if (served) return;
    if (!(await this.hasPriorContact(viewerId, targetId))) throw Errors.USER_NOT_FOUND();
  }

  /** `served_at < now() - 30 gün` satırlarını siler; günlük cron çağırır. */
  async purgeExpired(): Promise<number> {
    const { count, error } = await supabase
      .from("discover_served")
      .delete({ count: "exact" })
      .lt("served_at", cutoffIso());
    if (error) {
      console.error("[served-gate] temizlik hatasi:", error.code ?? "kod yok");
      throw Errors.SERVER_ERROR();
    }
    return count ?? 0;
  }

  /** PK araması: (viewer_id, target_id) + 30 gün. */
  private async servedRecently(viewerId: string, targetId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("discover_served")
      .select("target_id")
      .eq("viewer_id", viewerId)
      .eq("target_id", targetId)
      .gte("served_at", cutoffIso())
      .limit(1);
    return this.exists(data, error);
  }

  /**
   * Yalnız gösterim kaydı yokken (deploy öncesi kartlar, 30 günü geçen etkileşim): izleyicinin LIKE'ı,
   * aradaki eşleşme (pasif dahil) ya da izleyicinin önceki quiz oturumu. Üç indeksli sorgu, paralel.
   */
  private async hasPriorContact(viewerId: string, targetId: string): Promise<boolean> {
    const [like, match, quiz] = await Promise.all([
      supabase
        .from("swipes")
        .select("id")
        .eq("swiper_id", viewerId)
        .eq("target_id", targetId)
        .eq("action", "LIKE")
        .limit(1),
      supabase
        .from("matches")
        .select("id")
        .or(
          `and(user1_id.eq.${viewerId},user2_id.eq.${targetId}),and(user1_id.eq.${targetId},user2_id.eq.${viewerId})`,
        )
        .limit(1),
      supabase
        .from("quiz_sessions")
        .select("id")
        .eq("solver_id", viewerId)
        .eq("target_id", targetId)
        .limit(1),
    ]);
    return [like, match, quiz].map(({ data, error }) => this.exists(data, error)).some(Boolean);
  }

  /** Okuma hatası kapıyı sessizce açmaz ya da kapatmaz: SERVER_ERROR (log yalnız kod). */
  private exists(data: unknown[] | null, error: { code?: string } | null): boolean {
    if (error) {
      console.error("[served-gate] kapi okumasi hatasi:", error.code ?? "kod yok");
      throw Errors.SERVER_ERROR();
    }
    return (data?.length ?? 0) > 0;
  }
}

export const servedGate = new ServedGateService();
