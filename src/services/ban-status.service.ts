import { supabase } from "../config/supabase.js";
import { TtlCache } from "../utils/ttl-cache.js";

/**
 * Kimlikli her istekte `users.is_banned` okunuyordu: API çağrısı başına +1 Supabase isteği
 * (2026-09-28 maliyet incelemesi). Ban/unban tek yoldan (`banService`) geçer ve bu süreçte
 * önbelleği anında temizler; doğrudan SQL ile verilen ban en geç bu süre sonunda işler.
 */
export const BAN_DURUMU_TTL_MS = 60_000;

class BanStatusService {
  private readonly onbellek = new TtlCache<string, boolean>(BAN_DURUMU_TTL_MS);

  /**
   * Okuma hatasında `false` döner — istek durdurulmaz (önbellek öncesi davranış) — ve sonuç
   * önbelleğe YAZILMAZ: kısa bir kesinti 60 sn boyunca "banlı değil" diye sabitlenmesin.
   * Ban anında süren okuma eski değeri geri yazamaz (`getOrLoad` nesil kontrolü).
   */
  async isBanned(userId: string): Promise<boolean> {
    const banli = await this.onbellek.getOrLoad(userId, async () => {
      const { data, error } = await supabase
        .from("users")
        .select("is_banned")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.error("[auth] ban durumu okunamadi:", error.message);
        return undefined;
      }
      return data?.is_banned === true;
    });
    return banli ?? false;
  }

  invalidate(userId: string): void {
    this.onbellek.delete(userId);
  }
}

export const banStatusService = new BanStatusService();
