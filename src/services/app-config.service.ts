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
 * Discover'da "uyuyan" aday esigi (gun) — `app_config.discover_dormant_days` (migration 074, deger
 * 080'de 3'e indi) okunamazsa (kolon henuz yok / okuma hatasi) kullanilir. 0 = siralama kapali.
 * 2026-11-09: hedeflerin %79'u eslesme aninda >=3 gundur gorulmemisti → 14 gun cok gevsekti.
 */
export const DEFAULT_DISCOVER_DORMANT_DAYS = 3;

/**
 * Bu kadar gundur gorulmeyen aday desteden CIKAR (`app_config.discover_inactive_exclude_days`,
 * migration 080). 0 = kapali. Uyuyan siralamasinin (3 gun) sert ust siniri.
 */
export const DEFAULT_DISCOVER_INACTIVE_EXCLUDE_DAYS = 30;

/**
 * Hedef basina cevapsiz eslesme tavani (`app_config.discover_unanswered_match_cap`, migration 080):
 * son 30 gunde bu kadar aktif eslesmesinde hic yazmamis aday listenin sonuna gider. 0 = kapali.
 * 2026-11-09: eslesmeler 53 hedefte yigilmisti (tek hedefe 21).
 */
export const DEFAULT_DISCOVER_UNANSWERED_MATCH_CAP = 3;

/**
 * "Seni cozduler" e-posta yedegi (`app_config.recall_email_enabled`, migration 080). Gercek kullaniciya
 * e-posta gonderir: fail-closed, kolon yoksa / okunamazsa KAPALI; acma karari kullanicida.
 */
export const DEFAULT_RECALL_EMAIL_ENABLED = false;

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

/**
 * Onboarding güç demosu uzaktan kapatma anahtarı (spec 2026-10-17 §7.1) — `app_config.power_demo_enabled`
 * (migration 078). Diğer anahtarların TERSİNE kolon yoksa / okunamazsa AÇIK: demo varsayılan akıştır,
 * mobil de alan yoksa aynı şekilde demoyu gösterir; kapatmak bilinçli bir admin kararıdır.
 */
export const DEFAULT_POWER_DEMO_ENABLED = true;

/**
 * Reklam (AdMob) uzaktan açma anahtarı — `app_config.ads_enabled` (migration 079). Güç demosunun TERSİNE
 * fail-closed: kolon yoksa / okunamazsa KAPALI; gerçek AdMob kimlikleri girilip bilinçli açılana dek reklam yok.
 */
export const DEFAULT_ADS_ENABLED = false;

/** `getRow` kolon listesinden AYRI okunan anahtarlar (migration'ı deploy'dan sonra gelebilir). */
type BooleanFlagColumn =
  | "mutual_match_enabled"
  | "served_gate_enabled"
  | "power_demo_enabled"
  | "ads_enabled"
  | "recall_email_enabled";

/** `getRow` kolon listesinden AYRI okunan tam sayi ayarlari (0 = kapali, negatif gecersiz). */
type IntegerSettingColumn = "discover_dormant_days" | "discover_inactive_exclude_days" | "discover_unanswered_match_cap";

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
  private readonly dormantOnbellek = new TtlCache<"deger", number>(APP_CONFIG_TTL_MS);
  private readonly inactiveExcludeOnbellek = new TtlCache<"deger", number>(APP_CONFIG_TTL_MS);
  private readonly unansweredCapOnbellek = new TtlCache<"deger", number>(APP_CONFIG_TTL_MS);
  private readonly mutualOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private readonly servedGateOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private readonly powerDemoOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private readonly adsOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  private readonly recallEmailOnbellek = new TtlCache<"acik", boolean>(APP_CONFIG_TTL_MS);
  /** Kolon yok / gecersiz deger uyarisi surec basina kolon basina bir kez. */
  private readonly uyariVerilenKolonlar = new Set<IntegerSettingColumn>();

  /** Discover uyuyan-aday esigi (gun, migration 074/080). */
  async getDiscoverDormantDays(): Promise<number> {
    return this.readIntegerSetting("discover_dormant_days", this.dormantOnbellek, DEFAULT_DISCOVER_DORMANT_DAYS);
  }

  /** Discover dislama esigi (gun, migration 080) — 0 = kapali. */
  async getDiscoverInactiveExcludeDays(): Promise<number> {
    return this.readIntegerSetting(
      "discover_inactive_exclude_days", this.inactiveExcludeOnbellek, DEFAULT_DISCOVER_INACTIVE_EXCLUDE_DAYS,
    );
  }

  /** Discover cevapsiz eslesme tavani (migration 080) — 0 = kapali. */
  async getDiscoverUnansweredMatchCap(): Promise<number> {
    return this.readIntegerSetting(
      "discover_unanswered_match_cap", this.unansweredCapOnbellek, DEFAULT_DISCOVER_UNANSWERED_MATCH_CAP,
    );
  }

  /**
   * Tam sayi ayari, `getRow` kolon listesinden AYRI okunur: migration uygulanmadan deploy edilirse
   * `getRow` (bakim modu, seed kill-switch) bozulmasin diye. Kolon yoksa (42703) varsayilan TTL boyunca
   * onbellekte kalir (her discover istegi DB'ye gitmez; uyari surec basina bir kez). Gecici okuma hatasi
   * onbelleklenmez: admin 0 (kapali) yaptiysa bir DB dalgalanmasi ayari 60 sn boyunca geri acmasin.
   */
  private async readIntegerSetting(
    column: IntegerSettingColumn,
    cache: TtlCache<"deger", number>,
    fallback: number,
  ): Promise<number> {
    const deger = await cache.getOrLoad("deger", async () => {
      const { data, error } = await supabase
        .from("app_config")
        .select(column)
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "42703") {
        console.error(`[app-config] ${column} okuma hatasi:`, error.message);
        return undefined;
      }
      const ham = (data as Record<string, unknown> | null)?.[column];
      if (error || typeof ham !== "number" || !Number.isInteger(ham) || ham < 0) {
        if (!this.uyariVerilenKolonlar.has(column)) {
          this.uyariVerilenKolonlar.add(column);
          console.warn(`[app-config] ${column} okunamadi (${error?.message ?? "deger yok"}); varsayilan ${fallback}`);
        }
        return fallback;
      }
      return ham;
    });
    return deger ?? fallback;
  }

  /** Karşılıklı eşleşme anahtarı (migration 075). */
  async getMutualMatchEnabled(): Promise<boolean> {
    return this.readBooleanFlag("mutual_match_enabled", this.mutualOnbellek, DEFAULT_MUTUAL_MATCH_ENABLED);
  }

  /** Gösterim kapısı anahtarı (migration 077). */
  async getServedGateEnabled(): Promise<boolean> {
    return this.readBooleanFlag("served_gate_enabled", this.servedGateOnbellek, DEFAULT_SERVED_GATE_ENABLED);
  }

  /** Güç demosu anahtarı (migration 078) — kolon yoksa AÇIK. */
  async getPowerDemoEnabled(): Promise<boolean> {
    return this.readBooleanFlag("power_demo_enabled", this.powerDemoOnbellek, DEFAULT_POWER_DEMO_ENABLED);
  }

  /** Reklam anahtarı (migration 079) — kolon yoksa KAPALI. */
  async getAdsEnabled(): Promise<boolean> {
    return this.readBooleanFlag("ads_enabled", this.adsOnbellek, DEFAULT_ADS_ENABLED);
  }

  /** "Seni cozduler" e-posta yedegi anahtari (migration 080) — kolon yoksa KAPALI. */
  async getRecallEmailEnabled(): Promise<boolean> {
    return this.readBooleanFlag("recall_email_enabled", this.recallEmailOnbellek, DEFAULT_RECALL_EMAIL_ENABLED);
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
        // Satır okunamadıysa anahtar da bilinmez: sözleşme alanı yine de hep döner.
        powerDemoEnabled: DEFAULT_POWER_DEMO_ENABLED,
        adsEnabled: DEFAULT_ADS_ENABLED,
      };
    }

    const isIos = platform === "ios";
    const lang = locale.startsWith("tr") ? "tr" : "en";
    // `getRow` kolon listesinden AYRI okunur (078 deploy'dan sonra gelebilir); 60 sn önbellekli.
    const powerDemoEnabled = await this.getPowerDemoEnabled();
    const adsEnabled = await this.getAdsEnabled();

    return {
      minVersion: isIos ? row.min_version_ios : row.min_version_android,
      latestVersion: isIos ? row.latest_version_ios : row.latest_version_android,
      storeUrl: isIos ? row.store_url_ios : row.store_url_android,
      isMaintenance: row.is_maintenance,
      maintenanceMessage: row.is_maintenance
        ? (lang === "tr" ? row.maintenance_message_tr : row.maintenance_message_en)
        : null,
      isForceUpdateEnabled: row.is_force_update_enabled,
      powerDemoEnabled,
      adsEnabled,
    };
  }

  async updateConfig(
    updates: Partial<Omit<AppConfigRow, "id" | "updated_at">> & {
      discover_dormant_days?: number;
      discover_inactive_exclude_days?: number;
      discover_unanswered_match_cap?: number;
      recall_email_enabled?: boolean;
      mutual_match_enabled?: boolean;
      served_gate_enabled?: boolean;
      power_demo_enabled?: boolean;
      ads_enabled?: boolean;
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
    this.inactiveExcludeOnbellek.clear();
    this.unansweredCapOnbellek.clear();
    this.recallEmailOnbellek.clear();
    this.mutualOnbellek.clear();
    this.servedGateOnbellek.clear();
    this.powerDemoOnbellek.clear();
    this.adsOnbellek.clear();
    if (error) throw error;
    return data;
  }
}

export const appConfigService = new AppConfigService();
