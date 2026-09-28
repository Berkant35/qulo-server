import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { TtlCache } from "../utils/ttl-cache.js";
import type { RewardBrand } from "../validators/rewards.validator.js";

/**
 * Aktif hediye kartı kataloğu — tüm ülkeler, süreç içi 60 sn önbellek (spec 2026-09-28 §5.3–§5.4).
 * Market açılışı, itfa ürün okuması ve bölüm kartı çözümü buradan okur: katalog nadiren değişir, her
 * market açılışında DB'ye gitmesi maliyet bekçisine aykırı. Admin katalog yazımı bu süreçte
 * `invalidate()` çağırır (başka replika en geç TTL sonunda görür).
 */
export const CATALOG_CACHE_TTL_MS = 60_000;

/** Katalog küçük (ülke başına birkaç kupür); yine de sınırsız okuma yok. */
const ACTIVE_ITEM_LIMIT = 500;
const MARKET_ITEM_COLUMNS = "id, brand_key, country_code, currency, face_value, rainbow_price, logo_url";

export interface MarketItem {
  id: string;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  rainbow_price: number;
  logo_url: string | null;
}

/** PostgREST numeric'i sayı döner; yine de tek yerde `Number` ile sabitlenir. */
export function toMarketItem(row: MarketItem): MarketItem {
  return {
    id: row.id,
    brand_key: row.brand_key,
    country_code: row.country_code,
    currency: row.currency,
    face_value: Number(row.face_value),
    rainbow_price: row.rainbow_price,
    logo_url: row.logo_url ?? null,
  };
}

class RewardsCatalogCache {
  private readonly cache = new TtlCache<"active", ReadonlyArray<MarketItem>>(CATALOG_CACHE_TTL_MS, 1);

  /** Paylaşılan liste — değiştirme. Okuma hatası fırlatılır ve önbelleğe yazılmaz (`getOrLoad`). */
  async listActive(): Promise<ReadonlyArray<MarketItem>> {
    const items = await this.cache.getOrLoad("active", async () => {
      const { data, error } = await supabase
        .from("reward_catalog_items")
        .select(MARKET_ITEM_COLUMNS)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("country_code", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("face_value", { ascending: true })
        .limit(ACTIVE_ITEM_LIMIT);
      if (error) {
        console.error("[rewards-catalog] aktif katalog okunamadi:", error.message);
        throw Errors.SERVER_ERROR();
      }
      const rows = (data ?? []) as MarketItem[];
      if (rows.length >= ACTIVE_ITEM_LIMIT) {
        // Sessiz kesilme olmasın: sınırın ötesindeki ürünler markette görünmez VE itfa edilemez (getActive yok der).
        console.warn(
          `[rewards-catalog] aktif katalog ${ACTIVE_ITEM_LIMIT} satir sinirinda — sinir otesindeki urunler listelenmez ve itfa edilemez`,
          { limit: ACTIVE_ITEM_LIMIT },
        );
      }
      return rows.map(toMarketItem);
    });
    return items ?? [];
  }

  /** `countryCode` null = tüm ülkeler (test admin). DB sırası korunur. */
  async listForCountry(countryCode: string | null): Promise<MarketItem[]> {
    const all = await this.listActive();
    return countryCode === null ? [...all] : all.filter((item) => item.country_code === countryCode);
  }

  async getActive(id: string): Promise<MarketItem | null> {
    return (await this.listActive()).find((item) => item.id === id) ?? null;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export const rewardsCatalogCache = new RewardsCatalogCache();
