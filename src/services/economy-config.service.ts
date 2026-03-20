import { supabase } from "../config/supabase.js";
import {
  economyConfigSchema,
  type EconomyConfig,
  type EconomyConfigVersion,
  type ConfigDiff,
} from "../types/economy-config.schema.js";

class EconomyConfigService {
  private cachedConfig: { version: number; config: EconomyConfig } | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  }
}

export const economyConfigService = new EconomyConfigService();
