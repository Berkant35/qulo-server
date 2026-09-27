import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import type { ClientPlatform } from "../utils/client-meta.js";

/**
 * Rainbow'un (ve marketin) kime görünür olduğu — TEK KAYNAK. İstemci yalnız bu kararın
 * bayrağını okur (spec 2026-09-27 §2.4). Kapalı olan kullanıcıda rainbow arka planda birikir.
 */
export interface RainbowAccessUser {
  country: string | null;
  is_test_admin?: boolean | null;
  is_seed_profile?: boolean | null;
  is_test_account?: boolean | null;
}

interface MarketCountryRow {
  country_code: string;
  enabled: boolean;
  android_enabled: boolean;
  ios_enabled: boolean;
}

/** Ülke anahtarları nadiren değişir; admin değiştirince `invalidate()` çağrılır (Plan 2). */
const CACHE_TTL_MS = 60_000;

export class RainbowAccessService {
  private cache: { at: number; rows: MarketCountryRow[] } | null = null;

  async isEnabled(user: RainbowAccessUser, platform?: ClientPlatform): Promise<boolean> {
    if (user.is_test_admin) return true;
    if (user.is_seed_profile || user.is_test_account) return false;
    if (!user.country || (platform !== "android" && platform !== "ios")) return false;

    const code = user.country.toUpperCase();
    const country = (await this.countries()).find((c) => c.country_code === code);
    if (!country?.enabled) return false;
    return platform === "ios" ? country.ios_enabled : country.android_enabled;
  }

  async isEnabledForUser(userId: string, platform?: ClientPlatform): Promise<boolean> {
    const { data, error } = await supabase
      .from("users")
      .select("country, is_test_admin, is_seed_profile, is_test_account")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
    return this.isEnabled(data as RainbowAccessUser, platform);
  }

  invalidate(): void {
    this.cache = null;
  }

  private async countries(): Promise<MarketCountryRow[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.rows;

    const { data, error } = await supabase
      .from("reward_market_countries")
      .select("country_code, enabled, android_enabled, ios_enabled");

    if (error) {
      // Fail-closed: okunamazsa market kimseye açılmaz (admin hariç); bayat önbellek varsa o.
      console.error("[rainbow-access] countries read failed:", error.message);
      return this.cache?.rows ?? [];
    }

    this.cache = { at: Date.now(), rows: (data ?? []) as MarketCountryRow[] };
    return this.cache.rows;
  }
}

export const rainbowAccessService = new RainbowAccessService();
