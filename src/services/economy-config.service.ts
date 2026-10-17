import { supabase } from "../config/supabase.js";
import { ORACLE_DEFAULT_ACCURACY } from "../constants/oracle.js";
import { TtlCache } from "../utils/ttl-cache.js";
import {
  economyConfigSchema,
  type EconomyConfig,
  type EconomyConfigVersion,
  type ConfigDiff,
} from "../types/economy-config.schema.js";

/** İstemcilere açık economy görünümü — `rainbow` bloğu hariç. */
export type PublicEconomyConfig = Omit<EconomyConfig, "rainbow">;

/**
 * Herkese açık `GET /api/v1/app/economy` yanıtı için: `rainbow` bloğu (abonelik ödenmiş payları,
 * anti-fraud hesap yaşı eşiği, itfa tavanı, maliyet tabanı) sunucu içi karar verisidir, dışarı
 * sızmaz. Mobil bu bloğu okumuyor (2026-09-27 grep). Admin editörü tam config ile çalışır.
 * Girişi değiştirmez — önbellekteki nesne paylaşılıyor.
 */
export function toPublicEconomyConfig(config: EconomyConfig): PublicEconomyConfig {
  const { rainbow: _internal, ...publicConfig } = config;
  return publicConfig;
}

class EconomyConfigService {
  private cachedConfig: { version: number; config: EconomyConfig } | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  /** Kâhin doğruluğu (`powers.accuracy_rate`) — config ile aynı TTL; `invalidateCache()` ikisini de temizler. */
  private readonly oracleAccuracyCache = new TtlCache<"oran", number>(this.CACHE_TTL_MS);

  async getActiveConfig(): Promise<{ version: number; config: EconomyConfig }> {
    if (this.cachedConfig && Date.now() < this.cacheExpiry) {
      return this.cachedConfig;
    }

    const { data, error } = await supabase
      .from("economy_config_versions")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .single();

    if (error || !data) {
      if (this.cachedConfig) return this.cachedConfig;
      throw new Error("No active economy config found");
    }

    const row = data as EconomyConfigVersion;
    const parsed = economyConfigSchema.parse(row.config);

    this.cachedConfig = { version: row.version, config: parsed };
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

    return this.cachedConfig;
  }

  /**
   * Kâhin gücünün doğruluk oranı, [0,1]'e sıkıştırılmış. Herkese açık `GET /app/economy` yanıtında
   * `oracleAccuracy` olarak döner (auth öncesi güç demosu); config şemasının parçası DEĞİL — oran
   * `powers` tablosunda yaşıyor ve şemaya eklemek aktif satırı parse edilemez kılıp sohbet akışını bozardı.
   *
   * Satır yok / sayıya çevrilemeyen değer → `ORACLE_DEFAULT_ACCURACY` (cevap önbelleğe girer).
   * Okuma hatası → yine varsayılan, ama önbelleğe YAZILMAZ: geçici hata 5 dk boyunca yanlış sayıyı sabitlemesin.
   */
  async getOracleAccuracy(): Promise<number> {
    const oran = await this.oracleAccuracyCache.getOrLoad("oran", async () => {
      const { data, error } = await supabase
        .from("powers")
        .select("accuracy_rate")
        .eq("name", "ORACLE")
        .maybeSingle();
      if (error) return undefined;

      // numeric kolon PostgREST'ten metin ("0.70") gelebilir; null Number(null)=0 olmasın diye ayrı ele alınır.
      const ham = data?.accuracy_rate;
      const sayi = ham == null ? Number.NaN : Number(ham);
      return Number.isFinite(sayi) ? Math.min(1, Math.max(0, sayi)) : ORACLE_DEFAULT_ACCURACY;
    });
    return oran ?? ORACLE_DEFAULT_ACCURACY;
  }

  async getConfig(): Promise<EconomyConfig> {
    const { config } = await this.getActiveConfig();
    return config;
  }

  async createVersion(
    config: EconomyConfig,
    changedBy: string,
    reason: string,
  ): Promise<EconomyConfigVersion> {
    const parsed = economyConfigSchema.parse(config);

    const { data: maxRow } = await supabase
      .from("economy_config_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (maxRow?.version ?? 0) + 1;

    // Try RPC for transaction safety
    const { data, error } = await supabase.rpc("create_economy_config_version", {
      p_version: nextVersion,
      p_config: parsed,
      p_changed_by: changedBy,
      p_change_reason: reason,
    });

    if (error) {
      // Fallback: two queries (acceptable for single-instance)
      await supabase
        .from("economy_config_versions")
        .update({ is_active: false })
        .eq("is_active", true);

      const { data: inserted, error: insertError } = await supabase
        .from("economy_config_versions")
        .insert({
          version: nextVersion,
          config: parsed,
          is_active: true,
          changed_by: changedBy,
          change_reason: reason,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      this.invalidateCache();
      return inserted as EconomyConfigVersion;
    }

    this.invalidateCache();
    return data as EconomyConfigVersion;
  }

  async getHistory(limit = 20): Promise<EconomyConfigVersion[]> {
    const { data, error } = await supabase
      .from("economy_config_versions")
      .select("id, version, is_active, changed_by, change_reason, created_at")
      .order("version", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as EconomyConfigVersion[];
  }

  async getVersion(version: number): Promise<EconomyConfigVersion | null> {
    const { data, error } = await supabase
      .from("economy_config_versions")
      .select("*")
      .eq("version", version)
      .limit(1)
      .single();

    if (error) return null;
    return data as EconomyConfigVersion;
  }

  compareVersions(v1: EconomyConfigVersion, v2: EconomyConfigVersion): ConfigDiff {
    const changes: ConfigDiff["changes"] = [];

    function diff(path: string, a: unknown, b: unknown) {
      if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
        const allKeys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
        for (const key of allKeys) {
          diff(
            `${path}.${key}`,
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
          );
        }
      } else if (a !== b) {
        changes.push({ path, oldValue: a, newValue: b });
      }
    }

    diff("config", v1.config, v2.config);

    return { v1: v1.version, v2: v2.version, changes };
  }

  invalidateCache(): void {
    this.cachedConfig = null;
    this.cacheExpiry = 0;
    this.oracleAccuracyCache.clear();
  }
}

export const economyConfigService = new EconomyConfigService();
