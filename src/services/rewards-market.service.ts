import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import type { ClientPlatform } from "../utils/client-meta.js";
import { CAP_STATUSES, monthStartUtc } from "../utils/rewards.js";
import type { RedemptionStatus, RewardBrand } from "../validators/rewards.validator.js";
import { economyConfigService } from "./economy-config.service.js";
import { rainbowAccessService, type RainbowAccessUser } from "./rainbow-access.service.js";

const USER_COLUMNS =
  "id, country, created_at, rainbow_diamonds, is_test_admin, is_seed_profile, is_test_account";
const ITEM_COLUMNS = "id, brand_key, country_code, currency, face_value, rainbow_price, logo_url";
const REDEMPTION_COLUMNS =
  "id, status, brand_key, country_code, currency, face_value, rainbow_price, delivery_code, delivery_url, reject_reason, created_at, decided_at";
/** Katalog küçük (ülke başına birkaç kupür); yine de sınırsız okuma yok. */
const MARKET_ITEM_LIMIT = 200;
/** Bir kullanıcının bir aydaki talepleri — tavan 150 rainbow iken birkaç satır; sınır savunma. */
const MONTH_SCAN_LIMIT = 1000;

export interface MarketItem {
  id: string;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  rainbow_price: number;
  logo_url: string | null;
}

export interface MarketView {
  balance: number;
  items: MarketItem[];
  /** null = tavan uygulanmaz (test admin). */
  monthly_cap: number | null;
  used_this_month: number;
}

export interface RedemptionView {
  id: string;
  status: RedemptionStatus;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  rainbow_price: number;
  delivery_code: string | null;
  delivery_url: string | null;
  reject_reason: string | null;
  created_at: string;
  decided_at: string | null;
}

interface MarketUser extends RainbowAccessUser {
  id: string;
  created_at: string;
  rainbow_diamonds: number | null;
}

/** PostgREST numeric'i sayı döner; yine de tek yerde `Number` ile sabitlenir. */
function toMarketItem(row: MarketItem): MarketItem {
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

function toRedemptionView(row: RedemptionView): RedemptionView {
  return {
    id: row.id,
    status: row.status,
    brand_key: row.brand_key,
    country_code: row.country_code,
    currency: row.currency,
    face_value: Number(row.face_value),
    rainbow_price: row.rainbow_price,
    delivery_code: row.delivery_code ?? null,
    delivery_url: row.delivery_url ?? null,
    reject_reason: row.reject_reason ?? null,
    created_at: row.created_at,
    decided_at: row.decided_at ?? null,
  };
}

/**
 * Rainbow market (spec 2026-09-27 §2.6). Görünürlük tek kaynaktan: `rainbowAccessService`.
 * Test admin tüm ülkelerin aktif ürünlerini görür (ülkeler kullanıcılara kapalıyken uçtan uca
 * deneme — kullanıcı isteği 2026-09-27).
 */
export class RewardsMarketService {
  /** Market ekranı. Erişim kapalıysa 403: katalog bile görünmez. */
  async getMarket(userId: string, platform?: ClientPlatform): Promise<MarketView> {
    const user = await this.loadUser(userId);
    if (!(await rainbowAccessService.isEnabled(user, platform))) throw Errors.RAINBOW_NOT_AVAILABLE();

    const isAdmin = user.is_test_admin === true;
    const [config, items, used] = await Promise.all([
      economyConfigService.getConfig(),
      this.listActiveItems(isAdmin ? null : (user.country ?? "").toUpperCase()),
      this.usedThisMonth(userId),
    ]);

    return {
      balance: user.rainbow_diamonds ?? 0,
      items,
      monthly_cap: isAdmin ? null : config.rainbow.monthlyRedeemCap,
      used_this_month: used,
    };
  }

  /**
   * Kullanıcının kendi talepleri. Erişim kontrolü YOK: ülke sonradan kapansa da teslim edilmiş kod
   * kullanıcının malıdır, görünmeye devam eder.
   */
  async listMyRedemptions(userId: string, page: number, limit: number) {
    const from = (page - 1) * limit;
    const { data, error, count } = await supabase
      .from("reward_redemptions")
      .select(REDEMPTION_COLUMNS, { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw Errors.SERVER_ERROR();

    return {
      items: ((data ?? []) as RedemptionView[]).map(toRedemptionView),
      total: count ?? 0,
      page,
      limit,
    };
  }

  private async loadUser(userId: string): Promise<MarketUser> {
    const { data, error } = await supabase.from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
    return data as MarketUser;
  }

  /** `countryCode` null = test admin: tüm ülkeler. */
  private async listActiveItems(countryCode: string | null): Promise<MarketItem[]> {
    let query = supabase
      .from("reward_catalog_items")
      .select(ITEM_COLUMNS)
      .eq("is_active", true)
      .is("deleted_at", null);
    if (countryCode !== null) query = query.eq("country_code", countryCode);

    const { data, error } = await query
      .order("country_code", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("face_value", { ascending: true })
      .limit(MARKET_ITEM_LIMIT);

    if (error) throw Errors.SERVER_ERROR();
    return ((data ?? []) as MarketItem[]).map(toMarketItem);
  }

  /** Bu takvim ayında (UTC) tavana sayılan talep toplamı. */
  private async usedThisMonth(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from("reward_redemptions")
      .select("rainbow_price")
      .eq("user_id", userId)
      .in("status", [...CAP_STATUSES])
      .gte("created_at", monthStartUtc(new Date()))
      .limit(MONTH_SCAN_LIMIT);

    if (error) throw Errors.SERVER_ERROR();
    return ((data ?? []) as { rainbow_price: number }[]).reduce((sum, r) => sum + r.rainbow_price, 0);
  }
}

export const rewardsMarketService = new RewardsMarketService();
