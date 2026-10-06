import { supabase } from "../config/supabase.js";
import { TtlCache } from "../utils/ttl-cache.js";

/**
 * Tek satırlık app_config her resume'da (/app/config) ve seed cron'unun her tikinde okunuyordu.
 * Admin güncellemesi bu süreçte önbelleği anında temizler; SQL ile yapılan değişiklik en geç
 * bu süre sonunda görünür (seed kill-switch dahil).
 */
export const APP_CONFIG_TTL_MS = 60_000;

/**
 * `AppConfigRow`'un tamamı — `select("*")` yerine (tablo 2026-09-28'de tam bu 15 kolon). Tek sabit
 * metin olmalı: `+` ile birleştirilirse supabase-js'in tip ayrıştırıcısı çözemez.
 */
const APP_CONFIG_KOLONLARI = "id, min_version_ios, min_version_android, latest_version_ios, latest_version_android, store_url_ios, store_url_android, is_maintenance, maintenance_message_tr, maintenance_message_en, is_force_update_enabled, seed_reply_enabled, seed_reply_fast_mode, photo_moderation_enabled, updated_at";

/**
 * Discover'da "uyuyan" aday esigi (gun) — `app_config.discover_dormant_days` (migration 074)
 * okunamazsa (kolon henuz yok / okuma hatasi) kullanilir. 0 = siralama kapali.
 */
export const DEFAULT_DISCOVER_DORMANT_DAYS = 14;

/**
 * Karşılıklı eşleşme kuralı (spec 2026-10-05) — `app_config.mutual_match_enabled` (migration 075).
 * Kolon yoksa / okunamazsa KAPALI: kural bugünkü tek yönlü filtreye düşer.
 */
export const DEFAULT_MUTUAL_MATCH_ENABLED = false;

/**
 * Gösterim kapısı (spec 2026-10-06 kehanet açığı) — `app_config.served_gate_enabled` (migration 077).
 * Kolon yoksa / okunamazsa KAPALI: yalnız engel kontrolü + tek tip 404 uygulanır.
 */
export const DEFAULT_SERVED_GATE_ENABLED = false;

/** `getRow` kolon listesinden AYRI okunan anahtarlar (migration'ı deploy'dan sonra gelebilir). */
type BooleanFlagColumn = "mutual_match_enabled" | "served_gate_enabled";

export interface AppConfigRow {
  id: string;
  min_version_ios: string;
  min_version_android: string;
  latest_version_ios: string;
  latest_version_android: string;
  store_url_ios: string;
  store_url_android: string;
  is_maintenance: boolean;
  maintenance_message_tr: string | null;
  maintenance_message_en: string | null;
  is_force_update_enabled: boolean;
  /** Seed AI cevap cron kill-switch'leri (migration 059). */
  seed_reply_enabled: boolean;
  seed_reply_fast_mode: boolean;
  /** Profil fotografi moderasyon cron kill-switch'i (migration 064). */
  photo_moderation_enabled: boolean;
  updated_at: string;
}

class AppConfigService {
  private readonly onbellek = new TtlCache<"satir", Readonly<AppConfigRow>>(APP_CONFIG_TTL_MS);
  private readonly dormantOnbellek = new TtlCache<"gun", number>(APP_CONFIG_TTL_MS);
  private readonly mutualOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private readonly servedGateOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private dormantUyariVerildi = false;

  /**
   * Discover uyuyan-aday esigi (gun). `getRow` kolon listesinden AYRI okunur: 074 uygulanmadan
   * deploy edilirse `getRow` (bakim modu, seed kill-switch) bozulmasin diye. Kolon yoksa varsayilan
   * TTL boyunca onbellekte kalir (her discover istegi DB'ye gitmez; uyari surec basina bir kez);
   * gecici okuma hatasinda o istek varsayilani kullanir, sonuc onbelleklenmez.
   */
  async getDiscoverDormantDays(): Promise<number> {
    const gun = await this.dormantOnbellek.getOrLoad("gun", async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select("discover_dormant_days")
        .limit(1)
        .maybeSingle();
      // Gecici okuma hatasi onbelleklenmez (sonraki istek tekrar dener): admin 0 (kapali)
      // yaptiysa bir DB dalgalanmasi siralamayi 60 sn boyunca geri acmasin. Yalniz kolon
      // yoksa (42703 — 074 uygulanmamis) varsayilan onbelleklenir.
      if (error && error.code !== "42703") {
        console.error("[app-config] discover_dormant_days okuma hatasi:", error.message);
        return undefined;
      }
      const deger = (data as { discover_dormant_days?: unknown } | null)?.discover_dormant_days;
      if (error || typeof deger !== "number" || !Number.isInteger(deger) || deger < 0) {
        if (!this.dormantUyariVerildi) {
          this.dormantUyariVerildi = true;
          console.warn(
            `[app-config] discover_dormant_days okunamadi (${error?.message ?? "deger yok"}); varsayilan ${DEFAULT_DISCOVER_DORMANT_DAYS} gun`,
          );
        }
        return DEFAULT_DISCOVER_DORMANT_DAYS;
      }
      return deger;
    });
    return gun ?? DEFAULT_DISCOVER_DORMANT_DAYS;
  }

  /** Karşılıklı eşleşme anahtarı (migration 075). */
  async getMutualMatchEnabled(): Promise<boolean> {
    return this.readBooleanFlag("mutual_match_enabled", this.mutualOnbellek, DEFAULT_MUTUAL_MATCH_ENABLED);
  }

  /** Gösterim kapısı anahtarı (migration 077). */
  async getServedGateEnabled(): Promise<boolean> {
    return this.readBooleanFlag("served_gate_enabled", this.servedGateOnbellek, DEFAULT_SERVED_GATE_ENABLED);
  }

  /**
   * Boolean anahtar, `getRow` kolon listesinden AYRI okunur (migration öncesi deploy `getRow`'u
   * bozmasın). Geçici okuma hatası önbelleklenmez; kolon yoksa (42703) varsayılan önbelleklenir.
   */
  private async readBooleanFlag(
    column: BooleanFlagColumn,
    cache: TtlCache<"acik", boolean>,
    fallback: boolean,
  ): Promise<boolean> {
    const acik = await cache.getOrLoad("acik", async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select(column)
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "42703") {
        console.error(`[app-config] ${column} okuma hatasi:`, error.message);
        return undefined;
      }
      const deger = (data as Record<string, unknown> | null)?.[column];
      return typeof deger === "boolean" ? deger : fallback;
    });
    return acik ?? fallback;
  }

  /**
   * Önbellekli satır (paylaşılan nesne — değiştirme). Okuma hatası `null` döner ve önbelleğe
   * YAZILMAZ; admin güncellemesi sırasında süren okuma eski satırı geri yazamaz (`getOrLoad`).
   */
  async getRow(): Promise<Readonly<AppConfigRow> | null> {
    const row = await this.onbellek.getOrLoad("satir", async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select(APP_CONFIG_KOLONLARI)
        .limit(1)
        .single();
      if (error || !data) {
        // Kesinti sessiz kalmasin: seed kill-switch bu durumda "kapali" sayilir.
        console.error("[app-config] okunamadi:", error?.message ?? "satir yok");
        return undefined;
      }
      return data as AppConfigRow;
    });
    return row ?? null;
  }

  async getConfig(platform: "ios" | "android", locale: string) {
    const row = await this.getRow();

    if (!row) {
      return {
        minVersion: "0.0.0",
        latestVersion: "0.0.0",
        storeUrl: "",
        isMaintenance: false,
        maintenanceMessage: null,
        isForceUpdateEnabled: false,
      };
    }

    const isIos = platform === "ios";
    const lang = locale.startsWith("tr") ? "tr" : "en";

    return {
      minVersion: isIos ? row.min_version_ios : row.min_version_android,
      latestVersion: isIos ? row.latest_version_ios : row.latest_version_android,
      storeUrl: isIos ? row.store_url_ios : row.store_url_android,
      isMaintenance: row.is_maintenance,
      maintenanceMessage: row.is_maintenance
        ? (lang === "tr" ? row.maintenance_message_tr : row.maintenance_message_en)
        : null,
      isForceUpdateEnabled: row.is_force_update_enabled,
    };
  }

  async updateConfig(
    updates: Partial<Omit<AppConfigRow, "id" | "updated_at">> & {
      discover_dormant_days?: number;
      mutual_match_enabled?: boolean;
      served_gate_enabled?: boolean;
    },
  ) {
    const { data: existing, error: fetchError } = await supabase
      .from("app_config")
      .select("id")
      .limit(1)
      .single();

    if (fetchError || !existing) {
      throw new Error(fetchError?.message ?? "app_config row not found");
    }

    const { data, error } = await supabase
      .from("app_config")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select(APP_CONFIG_KOLONLARI)
      .single();

    // Hata olsa bile temizle: yazımın gidip gitmediği belirsizse eski değeri sunmak daha kötü.
    this.onbellek.clear();
    this.dormantOnbellek.clear();
    this.mutualOnbellek.clear();
    this.servedGateOnbellek.clear();
    if (error) throw error;
    return data;
  }
}

export const appConfigService = new AppConfigService();
