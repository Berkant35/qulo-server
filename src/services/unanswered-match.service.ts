import { supabase } from "../config/supabase.js";
import { TtlCache } from "../utils/ttl-cache.js";
import { DAY_MS } from "./discover-ranking.js";

/** Cevapsiz eslesme sayiminin geriye bakma penceresi (gun). */
export const UNANSWERED_MATCH_WINDOW_DAYS = 30;

/**
 * Cevap verme payi: bundan taze eslesme "cevapsiz" sayilmaz. Aksi halde son bir saatte uc kez eslesen
 * aktif (cevap verecek) kisi daha yazma firsati bulmadan listenin sonuna inerdi.
 */
export const UNANSWERED_MATCH_GRACE_MS = DAY_MS;

/**
 * Sonuc tum izleyiciler icin aynidir (aday basina sayim): surec ici 5 dk onbellek → Discover istegi
 * basina DB yok, instance basina ~288 RPC/gun (supabase-cost-guard).
 */
export const UNANSWERED_MATCH_TTL_MS = 5 * 60_000;

/**
 * "Cevapsiz eslesmesi yigilmis" adaylar (2.0.18 plan madde 5). Son 30 gunde (en yeni 24 saat haric)
 * en az `cap` aktif eslesmesinde HIC mesaj atmamis kullanicilar — RPC `discover_unanswered_match_counts` (migration 080)
 * tum eslesmeleri tek geciste sayar ve yalniz esigi asanlari dondurur (id listesi yok, URL siniri yok).
 *
 * Bu sinyal yalniz siralama icindir: hata/eksik fonksiyon Discover'i bozmaz, bos kume doner (tavan o
 * tur uygulanmaz) ve loglanir. Hata sonucu onbelleklenmez — sonraki istek yeniden dener.
 */
class UnansweredMatchService {
  private readonly onbellek = new TtlCache<number, ReadonlySet<string>>(UNANSWERED_MATCH_TTL_MS, 16);

  async heavyUnansweredIds(cap: number, now: Date = new Date()): Promise<ReadonlySet<string>> {
    if (!Number.isInteger(cap) || cap <= 0) return new Set();
    const ids = await this.onbellek.getOrLoad(cap, async () => {
      const since = new Date(now.getTime() - UNANSWERED_MATCH_WINDOW_DAYS * DAY_MS).toISOString();
      const until = new Date(now.getTime() - UNANSWERED_MATCH_GRACE_MS).toISOString();
      const { data, error } = await supabase.rpc("discover_unanswered_match_counts", { p_since: since, p_until: until, p_min: cap });
      if (error) {
        console.error("[matching] unanswered RPC hatasi (tavan bu istekte uygulanmaz):", error.message);
        return undefined;
      }
      const rows = (data ?? []) as Array<{ user_id: string; unanswered: number }>;
      return new Set(rows.filter((r) => r.unanswered >= cap).map((r) => r.user_id));
    });
    return ids ?? new Set();
  }

  /** Test ve admin guncellemesi icin. */
  clear(): void {
    this.onbellek.clear();
  }
}

export const unansweredMatchService = new UnansweredMatchService();
