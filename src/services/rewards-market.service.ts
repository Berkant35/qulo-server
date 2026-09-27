import { randomUUID } from "crypto";
import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import type { ClientPlatform } from "../utils/client-meta.js";
import {
  accountAgeDays,
  CAP_STATUSES,
  monthStartUtc,
  redemptionReference,
  REWARD_REDEEM_REASON,
  REWARD_REFUND_REASON,
} from "../utils/rewards.js";
import type { RedemptionStatus, RewardBrand } from "../validators/rewards.validator.js";
import { diamondService } from "./diamond.service.js";
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

export interface RedemptionPage {
  items: RedemptionView[];
  total: number;
  page: number;
  limit: number;
}

export interface RedeemResult {
  redemption: RedemptionView;
  /** İşlemden sonraki rainbow bakiyesi. */
  balance: number;
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
  async listMyRedemptions(userId: string, page: number, limit: number): Promise<RedemptionPage> {
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

  /**
   * Hediye kartı itfası (spec §2.6). Kapı sırası kasıtlı: idempotency → erişim → hesap yaşı →
   * ürün/ülke → aylık tavan → rainbow CAS düşümü → talep. Test admin yaş/ülke/tavandan muaf.
   * Eşzamanlı iki FARKLI talep tavanı birlikte aşabilir (tavan okuma-yazma atomik değil) — her talep
   * zaten admin onayından geçer; bakiye ise CAS ile korunur (fazla harcama olmaz).
   */
  async redeem(
    userId: string,
    input: { itemId: string; idempotencyKey: string },
    platform?: ClientPlatform,
  ): Promise<RedeemResult> {
    // Aynı anahtar = aynı talep. Kural kapılarından ÖNCE: ilk istek geçtiyse tekrarı da aynı sonucu görür.
    const replay = await this.findByKey(userId, input.idempotencyKey);
    if (replay) return { redemption: replay, balance: await this.rainbowBalance(userId) };

    const user = await this.loadUser(userId);
    if (!(await rainbowAccessService.isEnabled(user, platform))) throw Errors.RAINBOW_NOT_AVAILABLE();

    const isAdmin = user.is_test_admin === true;
    const rules = (await economyConfigService.getConfig()).rainbow;

    // Kapalı kalır: yaş hesaplanamazsa (NaN) "yeni" sayılır — `< min` NaN'da kapıyı açardı.
    if (!isAdmin && !(accountAgeDays(user.created_at, new Date()) >= rules.minAccountAgeDays)) {
      throw Errors.REWARD_ACCOUNT_TOO_NEW(rules.minAccountAgeDays);
    }

    // Başka ülkenin ürünü "yok" gibi davranır (varlığı sızdırılmaz).
    const item = await this.loadActiveItem(input.itemId);
    if (!item || (!isAdmin && item.country_code !== (user.country ?? "").toUpperCase())) {
      throw Errors.REWARD_ITEM_UNAVAILABLE();
    }

    if (!isAdmin) {
      const used = await this.usedThisMonth(userId);
      if (used + item.rainbow_price > rules.monthlyRedeemCap) {
        return this.replayOrThrow(userId, input.idempotencyKey, Errors.REWARD_MONTHLY_CAP(rules.monthlyRedeemCap, used));
      }
    }

    const redemptionId = randomUUID();
    const reference = redemptionReference(redemptionId);
    // Yetersizse INSUFFICIENT_DIAMONDS — hiçbir şey yazılmaz.
    let balance: number;
    try {
      ({ rainbow: balance } = await diamondService.spendRainbow(userId, item.rainbow_price, REWARD_REDEEM_REASON, reference));
    } catch (err) {
      if (err instanceof AppError && err.code === "INSUFFICIENT_DIAMONDS") {
        return this.replayOrThrow(userId, input.idempotencyKey, err);
      }
      throw err;
    }

    const { data, error } = await supabase
      .from("reward_redemptions")
      .insert({
        id: redemptionId,
        user_id: userId,
        item_id: item.id,
        status: "PENDING",
        rainbow_price: item.rainbow_price,
        brand_key: item.brand_key,
        country_code: item.country_code,
        currency: item.currency,
        face_value: item.face_value,
        idempotency_key: input.idempotencyKey,
        platform: platform === "ios" || platform === "android" ? platform : null,
        is_test: isAdmin,
      })
      .select(REDEMPTION_COLUMNS)
      .single();

    if (error || !data) {
      // Hata dönmüş olabilir ama satır GERÇEKTEN yazılmış olabilir (yanıt kayboldu — ör. commit
      // sonrası ağ/gateway hatası). İade etmeden ÖNCE anahtarla tekrar oku: kayıp cevap ≠ yazılmamış
      // satır. Okuma da patlarsa durum belirsizdir — bilmeden iade etmek bedava kart demek, o yüzden
      // iade YAPILMAZ; iz bırakılır.
      let found: RedemptionView | null;
      try {
        found = await this.findByKey(userId, input.idempotencyKey);
      } catch (lookupErr) {
        console.error("[rewards] CRITICAL: redemption insert error AND key lookup failed — belirsiz durum, iade YAPILMADI", {
          userId, amount: item.rainbow_price, reference, redemptionId, err: lookupErr,
        });
        throw Errors.SERVER_ERROR();
      }

      if (found?.id === redemptionId) {
        // Bizim insert'imiz aslında yazılmış, sadece cevap kaybolmuş — iade YOK.
        return { redemption: found, balance };
      }
      if (found) {
        // Aynı anahtarla başka istek kazanmış (ör. 23505) — bizimki iade edilir, kazanan döner.
        await this.refundUnrecorded(userId, item.rainbow_price, reference);
        return { redemption: found, balance: await this.rainbowBalance(userId) };
      }
      // Satır hiç yazılmamış: iade edilir.
      await this.refundUnrecorded(userId, item.rainbow_price, reference);
      throw Errors.SERVER_ERROR();
    }

    return { redemption: toRedemptionView(data as RedemptionView), balance };
  }

  /**
   * Aynı anahtarlı eşzamanlı ikinci istek: baştaki kontrol boş gördü ama kazanan talep araya girip
   * tavanı doldurdu ya da bakiyeyi düşürdü. Kaybeden hata değil kazananın talebini görür (tekrar
   * semantiği); anahtarla talep yoksa kapının hatası aynen döner.
   */
  private async replayOrThrow(userId: string, idempotencyKey: string, gateError: AppError): Promise<RedeemResult> {
    const winner = await this.findByKey(userId, idempotencyKey);
    if (!winner) throw gateError;
    return { redemption: winner, balance: await this.rainbowBalance(userId) };
  }

  private async findByKey(userId: string, idempotencyKey: string): Promise<RedemptionView | null> {
    const { data, error } = await supabase
      .from("reward_redemptions")
      .select(REDEMPTION_COLUMNS)
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return data ? toRedemptionView(data as RedemptionView) : null;
  }

  private async loadActiveItem(itemId: string): Promise<MarketItem | null> {
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .select(ITEM_COLUMNS)
      .eq("id", itemId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return data ? toMarketItem(data as MarketItem) : null;
  }

  private async rainbowBalance(userId: string): Promise<number> {
    return (await diamondService.getBalance(userId)).rainbow;
  }

  /** Telafi de başarısız olursa rainbow düşmüş, talep yok: defterdeki REWARD_REDEEM satırı elle kurtarma izi. */
  private async refundUnrecorded(userId: string, amount: number, reference: string): Promise<void> {
    try {
      await diamondService.earnRainbow(userId, amount, REWARD_REFUND_REASON, reference);
    } catch (err) {
      console.error("[rewards] CRITICAL: redemption insert failed AND refund failed", { userId, amount, reference, err });
    }
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
