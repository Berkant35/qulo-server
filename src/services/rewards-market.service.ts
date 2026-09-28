import { randomUUID } from "crypto";
import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import type { ClientPlatform } from "../utils/client-meta.js";
import type { SupportedLocale } from "../constants/locales.js";
import {
  REWARDS_MARKET_PAGE,
  toTargetPlatform,
  type PageSectionView,
  type TargetPlatform,
  type ViewerContext,
} from "../utils/page-sections.js";
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
import { pageSectionsService } from "./page-sections.service.js";
import { rainbowAccessService, type RainbowAccessUser } from "./rainbow-access.service.js";
import { rewardsCatalogCache, type MarketItem } from "./rewards-catalog-cache.js";

export type { MarketItem } from "./rewards-catalog-cache.js";

const USER_COLUMNS =
  "id, country, created_at, rainbow_diamonds, is_test_admin, is_seed_profile, is_test_account, has_reward_redemptions";
const REDEMPTION_COLUMNS =
  "id, status, brand_key, country_code, currency, face_value, rainbow_price, delivery_code, delivery_url, reject_reason, created_at, decided_at";
/** Bir kullanıcının bir aydaki talepleri — tavan 150 rainbow iken birkaç satır; sınır savunma. */
const MONTH_SCAN_LIMIT = 1000;
/** Postgres yabancı anahtar ihlali — ör. kaynak kart okuma ile talep yazımı arasında kalıcı silindi. */
const FOREIGN_KEY_VIOLATION = "23503";

export interface MarketView {
  balance: number;
  items: MarketItem[];
  /** null = tavan uygulanmaz (test admin). */
  monthly_cap: number | null;
  used_this_month: number;
  sections: PageSectionView<MarketItem>[];
}

export interface MarketOptions {
  /** Bölüm metinlerinin dili (Accept-Language). */
  locale?: SupportedLocale;
  /** Yalnız test admin: katalog + bölümler bu ülkeye süzülür; yoksa "Tümü". Normal kullanıcıda yok sayılır. */
  previewCountry?: string;
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
  has_reward_redemptions?: boolean | null;
}

export interface RedemptionPage {
  items: RedemptionView[];
  total: number;
  page: number;
  limit: number;
}

/** `reward_redemptions` insert satırı (talep anında ürünün anlık görüntüsü). */
interface RedemptionInsert {
  id: string;
  user_id: string;
  item_id: string;
  status: "PENDING";
  rainbow_price: number;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  idempotency_key: string;
  platform: TargetPlatform | null;
  is_test: boolean;
  source_item_id: string | null;
}

export interface RedeemResult {
  redemption: RedemptionView;
  /** İşlemden sonraki rainbow bakiyesi. */
  balance: number;
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
 * Katalog 60 sn önbellekten (rewards-catalog-cache); admin yazımı bu süreçte hemen düşürür.
 */
export class RewardsMarketService {
  /** Market ekranı. Erişim kapalıysa 403: katalog bile görünmez. */
  async getMarket(userId: string, platform?: ClientPlatform, options: MarketOptions = {}): Promise<MarketView> {
    const user = await this.loadUser(userId);
    if (!(await rainbowAccessService.isEnabled(user, platform))) throw Errors.RAINBOW_NOT_AVAILABLE();

    const viewer = this.viewerOf(user, platform, options.locale ?? "en", options.previewCountry);
    const [config, items, used] = await Promise.all([
      economyConfigService.getConfig(),
      rewardsCatalogCache.listForCountry(viewer.country),
      this.usedThisMonth(userId),
    ]);
    const sections = await this.sectionsFor(viewer, items);

    return {
      balance: user.rainbow_diamonds ?? 0,
      items,
      monthly_cap: viewer.isTestAdmin ? null : config.rainbow.monthlyRedeemCap,
      used_this_month: used,
      sections,
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
    input: { itemId: string; idempotencyKey: string; sourceItemId?: string },
    platform?: ClientPlatform,
    locale: SupportedLocale = "en",
  ): Promise<RedeemResult> {
    // Aynı anahtar = aynı talep. Kural kapılarından ÖNCE: ilk istek geçtiyse tekrarı da aynı sonucu görür.
    const replay = await this.findByKey(userId, input.idempotencyKey);
    if (replay) return { redemption: replay, balance: await this.rainbowBalance(userId) };

    const user = await this.loadUser(userId);
    if (!(await rainbowAccessService.isEnabled(user, platform))) throw Errors.RAINBOW_NOT_AVAILABLE();

    const viewer = this.viewerOf(user, platform, locale);
    const isAdmin = viewer.isTestAdmin;
    const rules = (await economyConfigService.getConfig()).rainbow;

    // Kapalı kalır: yaş hesaplanamazsa (NaN) "yeni" sayılır — `< min` NaN'da kapıyı açardı.
    if (!isAdmin && !(accountAgeDays(user.created_at, new Date()) >= rules.minAccountAgeDays)) {
      throw Errors.REWARD_ACCOUNT_TOO_NEW(rules.minAccountAgeDays);
    }

    // Başka ülkenin ürünü "yok" gibi davranır (varlığı sızdırılmaz).
    const item = await rewardsCatalogCache.getActive(input.itemId);
    if (!item || (!isAdmin && item.country_code !== viewer.country)) {
      throw Errors.REWARD_ITEM_UNAVAILABLE();
    }

    if (!isAdmin) {
      const used = await this.usedThisMonth(userId);
      if (used + item.rainbow_price > rules.monthlyRedeemCap) {
        return this.replayOrThrow(userId, input.idempotencyKey, Errors.REWARD_MONTHLY_CAP(rules.monthlyRedeemCap, used));
      }
    }

    // Kaynak kart yalnız bu kullanıcıya şu an görünen bir kartsa yazılır — ölçüm uydurma id ile şişmesin.
    const sourceItemId = await this.visibleSourceItem(input.sourceItemId, viewer, userId);

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

    const inserted = await this.insertRedemption({
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
      platform: toTargetPlatform(platform),
      is_test: isAdmin,
      source_item_id: sourceItemId,
    });

    if (!inserted) {
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
        await this.markHasRedemptions(user);
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

    await this.markHasRedemptions(user);
    return { redemption: inserted, balance };
  }

  /**
   * Talebi yazar; yazılamadıysa null (çağıran kayıp cevap / iade yolunu işletir). Kaynak kart görünürlük
   * okuması ile yazım arasında kalıcı silinmişse (FK 23503) ölçüm bağı düşürülüp BİR kez yeniden denenir:
   * ölçüm itfayı düşürmez. 23503 satır yazılmadı demektir; tekrar aynı id + anahtarla gider, onun hatası
   * da olağan yola düşer.
   */
  private async insertRedemption(row: RedemptionInsert): Promise<RedemptionView | null> {
    let { data, error } = await this.writeRedemption(row);
    if (error?.code === FOREIGN_KEY_VIOLATION && row.source_item_id !== null) {
      console.warn("[rewards] talep yazimi 23503 — kaynak kart silinmis olabilir, kaynaksiz yeniden deneniyor", {
        redemptionId: row.id, userId: row.user_id, sourceItemId: row.source_item_id, err: error.message,
      });
      ({ data, error } = await this.writeRedemption({ ...row, source_item_id: null }));
    }
    return error || !data ? null : toRedemptionView(data as RedemptionView);
  }

  private async writeRedemption(row: RedemptionInsert) {
    return supabase.from("reward_redemptions").insert(row).select(REDEMPTION_COLUMNS).single();
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

  private async rainbowBalance(userId: string): Promise<number> {
    return (await diamondService.getBalance(userId)).rainbow;
  }

  /**
   * Telafi de hata dönerse sonuç BELİRSİZ: iade CAS'ı commit etmiş olabilir (bakiye geri gelmiş, defter
   * satırı düşmemiş) ya da hiç yazılmamış olabilir. Defterdeki REWARD_REDEEM satırı elle kurtarma izi.
   */
  private async refundUnrecorded(userId: string, amount: number, reference: string): Promise<void> {
    try {
      await diamondService.earnRainbow(userId, amount, REWARD_REFUND_REASON, reference);
    } catch (err) {
      console.error(
        `[rewards] CRITICAL: redemption insert failed AND refund failed — outcome uncertain — check rainbow balance and the REWARD_REFUND row for ${reference}`,
        { userId, amount, reference, err },
      );
    }
  }

  /**
   * Bölümler vitrin süslemesidir: okunamazsa market bölümsüz sunulur ve olay loglanır — katalog ve itfa
   * bölüm tablolarına bağlı değil, bir bölüm arızası market ekranını kapatmasın.
   */
  private async sectionsFor(ctx: ViewerContext, catalog: MarketItem[]): Promise<PageSectionView<MarketItem>[]> {
    try {
      return await pageSectionsService.resolveForUser(REWARDS_MARKET_PAGE, ctx, catalog);
    } catch (err) {
      console.error("[rewards] page sections unavailable — market served without sections:", err);
      return [];
    }
  }

  /**
   * Görüntüleyenin bu an gördüğü bölüm kartlarından biri mi? Ölçüm itfayı asla düşürmez: katalog ya da
   * bölümler okunamazsa (herhangi bir hata) kaynak null yazılır, iz bırakılır.
   */
  private async visibleSourceItem(
    sourceItemId: string | undefined,
    viewer: ViewerContext,
    userId: string,
  ): Promise<string | null> {
    if (!sourceItemId) return null;
    try {
      const catalog = await rewardsCatalogCache.listForCountry(viewer.country);
      const sections = await this.sectionsFor(viewer, catalog);
      return sections.some((s) => s.items.some((item) => item.id === sourceItemId)) ? sourceItemId : null;
    } catch (err) {
      console.warn("[rewards] kaynak kart dogrulanamadi — talep kaynaksiz yazilir, itfa etkilenmez", {
        userId, sourceItemId, err,
      });
      return null;
    }
  }

  /**
   * Görüntüleyen (market, kaynak kart, itfa ülke kapısı tek kaynaktan): normal kullanıcı kendi ülkesiyle
   * (büyük harf); test admin önizleme ülkesiyle ya da "Tümü" (null = ülke süzmesi yok).
   */
  private viewerOf(
    user: MarketUser,
    platform: ClientPlatform | undefined,
    locale: SupportedLocale,
    previewCountry?: string,
  ): ViewerContext {
    const isTestAdmin = user.is_test_admin === true;
    return {
      country: isTestAdmin ? (previewCountry ?? null) : (user.country ?? "").toUpperCase(),
      platform: toTargetPlatform(platform),
      locale,
      isTestAdmin,
    };
  }

  /**
   * Tek yönlü bayrak: "Hediye kartlarım" girişi Rainbow kapalıyken de görünsün (spec §7.6). Yazılamazsa
   * itfa yine başarılıdır (talep kayıtlı); iz bırakılır, bir sonraki itfa yeniden dener.
   */
  private async markHasRedemptions(user: MarketUser): Promise<void> {
    if (user.has_reward_redemptions) return;
    const { error } = await supabase.from("users").update({ has_reward_redemptions: true }).eq("id", user.id);
    if (error) {
      console.error("[rewards] has_reward_redemptions yazilamadi — talep kayitli, bir sonraki itfa yeniden dener", {
        userId: user.id, err: error.message,
      });
    }
  }

  private async loadUser(userId: string): Promise<MarketUser> {
    const { data, error } = await supabase.from("users").select(USER_COLUMNS).eq("id", userId).maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
    return data as MarketUser;
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
