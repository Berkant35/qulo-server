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

  async updateConfig(updates: Partial<Omit<AppConfigRow, "id" | "updated_at">>) {
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
    if (error) throw error;
    return data;
  }
}

export const appConfigService = new AppConfigService();
