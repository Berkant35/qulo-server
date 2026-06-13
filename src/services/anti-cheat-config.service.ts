import { supabase } from "../config/supabase.js";
import {
  antiCheatConfigSchema,
  type AntiCheatConfig,
  type AntiCheatConfigRow,
} from "../types/anti-cheat-config.schema.js";

class AntiCheatConfigService {
  private cachedConfig: AntiCheatConfig | null = null;
  private cachedUpdatedAt: string | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  async getConfig(): Promise<AntiCheatConfig> {
    if (this.cachedConfig && Date.now() < this.cacheExpiry) {
      return this.cachedConfig;
    }

    const { data, error } = await supabase
      .from("anti_cheat_config")
      .select("*")
      .eq("id", 1)
      .limit(1)
      .single();

    if (error || !data) {
      if (this.cachedConfig) return this.cachedConfig;
      throw new Error("Anti-cheat config row missing");
    }

    const row = data as AntiCheatConfigRow;
    const parsed = antiCheatConfigSchema.parse(row.config);

    this.cachedConfig = parsed;
    this.cachedUpdatedAt = row.updated_at;
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

    return parsed;
  }

  async getRow(): Promise<AntiCheatConfigRow> {
    const { data, error } = await supabase
      .from("anti_cheat_config")
      .select("*")
      .eq("id", 1)
      .limit(1)
      .single();

    if (error || !data) throw new Error("Anti-cheat config row missing");
    return data as AntiCheatConfigRow;
  }

  async updateConfig(
    config: AntiCheatConfig,
    updatedBy: string,
  ): Promise<AntiCheatConfigRow> {
    const parsed = antiCheatConfigSchema.parse(config);

    const { data, error } = await supabase
      .from("anti_cheat_config")
      .update({
        config: parsed,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      })
      .eq("id", 1)
      .select()
      .single();

    if (error || !data) throw error ?? new Error("Failed to update anti-cheat config");

    this.invalidateCache();
    return data as AntiCheatConfigRow;
  }

  invalidateCache(): void {
    this.cachedConfig = null;
    this.cachedUpdatedAt = null;
    this.cacheExpiry = 0;
  }

  get cachedUpdatedAtIso(): string | null {
    return this.cachedUpdatedAt;
  }
}

export const antiCheatConfigService = new AntiCheatConfigService();
