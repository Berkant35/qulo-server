import { supabase } from "../config/supabase.js";
import type { Page } from "../types/pagination.js";
import { Errors } from "../utils/errors.js";
import type {
  AdminCatalogQuery,
  CatalogItemInput,
  CountrySwitchInput,
  RewardBrand,
} from "../validators/rewards.validator.js";
import { rainbowAccessService } from "./rainbow-access.service.js";

const COUNTRY_COLUMNS = "country_code, currency, enabled, android_enabled, ios_enabled, updated_at";
const CATALOG_COLUMNS =
  "id, brand_key, country_code, currency, face_value, cost_usd, rainbow_price, is_active, sort_order, logo_url, created_at, updated_at";
export const CATALOG_PAGE_SIZE = 50;

export interface MarketCountry {
  country_code: string;
  currency: string;
  enabled: boolean;
  android_enabled: boolean;
  ios_enabled: boolean;
  updated_at: string | null;
}

export interface CatalogItem {
  id: string;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  cost_usd: number | null;
  rainbow_price: number;
  is_active: boolean;
  sort_order: number;
  logo_url: string | null;
  created_at: string;
  updated_at: string | null;
}

/** PostgREST numeric'i sayı döner; yine de tek yerde `Number` ile sabitlenir. */
function toCatalogItem(row: CatalogItem): CatalogItem {
  return {
    ...row,
    face_value: Number(row.face_value),
    cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
    logo_url: row.logo_url ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/**
 * Backoffice "Rainbow Market" — ülke anahtarları ve katalog (spec §6). Yalnız süper admin çağırır
 * (rewards.admin.routes). Ülke anahtarı marketi gerçek kullanıcılara açar; katalog fiyatı bekleyen
 * talepleri etkilemez (talep açılışta ürünü anlık görüntüler). Talep kuyruğu: `rewards-queue.service`.
 */
export class RewardsCatalogAdminService {
  async listCountries(): Promise<MarketCountry[]> {
    const { data, error } = await supabase
      .from("reward_market_countries")
      .select(COUNTRY_COLUMNS)
      .order("country_code", { ascending: true });
    if (error) throw Errors.SERVER_ERROR();
    return (data ?? []) as MarketCountry[];
  }

  /**
   * Ülke/platform anahtarı. Bu süreçte erişim önbelleği hemen düşer; başka bir replika varsa
   * en geç önbellek süresi (60 sn) sonra görür.
   */
  async updateCountry(code: string, input: CountrySwitchInput): Promise<void> {
    const { data, error } = await supabase
      .from("reward_market_countries")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("country_code", code)
      .select("country_code")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.VALIDATION_ERROR({ country_code: "unknown market country" });
    rainbowAccessService.invalidate();
  }

  async listCatalog(filter: AdminCatalogQuery): Promise<Page<CatalogItem>> {
    const from = (filter.page - 1) * CATALOG_PAGE_SIZE;
    let query = supabase
      .from("reward_catalog_items")
      .select(CATALOG_COLUMNS, { count: "exact" })
      .is("deleted_at", null);
    if (filter.brand) query = query.eq("brand_key", filter.brand);
    if (filter.country) query = query.eq("country_code", filter.country);
    if (filter.status !== "all") query = query.eq("is_active", filter.status === "active");

    const { data, error, count } = await query
      .order("country_code", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("face_value", { ascending: true })
      .range(from, from + CATALOG_PAGE_SIZE - 1);

    if (error) throw Errors.SERVER_ERROR();
    return {
      items: ((data ?? []) as CatalogItem[]).map(toCatalogItem),
      total: count ?? 0,
      page: filter.page,
      pageSize: CATALOG_PAGE_SIZE,
    };
  }

  async getCatalogItem(id: string): Promise<CatalogItem | null> {
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .select(CATALOG_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return data ? toCatalogItem(data as CatalogItem) : null;
  }

  async createCatalogItem(input: CatalogItemInput): Promise<CatalogItem> {
    const row = await this.toCatalogRow(input);
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .insert(row)
      .select(CATALOG_COLUMNS)
      .single();
    if (error || !data) throw Errors.SERVER_ERROR();
    return toCatalogItem(data as CatalogItem);
  }

  async updateCatalogItem(id: string, input: CatalogItemInput): Promise<void> {
    const row = await this.toCatalogRow(input);
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.REWARD_ITEM_UNAVAILABLE();
  }

  /** İstenen durumu doğrudan yazar (okumadan): çift tıklama ya da tekrar gönderim güvenli. */
  async setCatalogActive(id: string, active: boolean): Promise<void> {
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.REWARD_ITEM_UNAVAILABLE();
  }

  /** Soft delete: geçmiş talepler ürüne FK ile bağlı; satır kalır, katalogdan ve marketten düşer. */
  async softDeleteCatalogItem(id: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("reward_catalog_items")
      .update({ is_active: false, deleted_at: now, updated_at: now })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) throw Errors.SERVER_ERROR();
  }

  /** Para birimi formdan gelmez: ülkenin para birimidir (TH → THB). Bilinmeyen ülke reddedilir. */
  private async toCatalogRow(input: CatalogItemInput) {
    const { data: country, error } = await supabase
      .from("reward_market_countries")
      .select("currency")
      .eq("country_code", input.country_code)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!country) throw Errors.VALIDATION_ERROR({ country_code: "unknown market country" });

    return {
      brand_key: input.brand_key,
      country_code: input.country_code,
      currency: (country as { currency: string }).currency,
      face_value: input.face_value,
      cost_usd: input.cost_usd ?? null,
      rainbow_price: input.rainbow_price,
      sort_order: input.sort_order,
      logo_url: input.logo_url ?? null,
      is_active: input.is_active,
    };
  }
}

export const rewardsCatalogAdminService = new RewardsCatalogAdminService();
