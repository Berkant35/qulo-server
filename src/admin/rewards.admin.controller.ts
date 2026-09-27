import type { Request, Response } from "express";
import type { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { suggestedRainbowPrice } from "../utils/rewards.js";
import { rewardsCatalogAdminService } from "../services/rewards-catalog-admin.service.js";
import { rewardsQueueService } from "../services/rewards-queue.service.js";
import { economyConfigService } from "../services/economy-config.service.js";
import {
  REWARD_BRANDS,
  adminCatalogQuerySchema,
  adminIdParamSchema,
  adminRedemptionsQuerySchema,
  catalogItemSchema,
  countrySwitchSchema,
  fulfillSchema,
  rejectSchema,
} from "../validators/rewards.validator.js";

/** `?error=` kodu → ekrandaki mesaj (backoffice Türkçe). Bilinmeyen kod gösterilmez. */
export const REWARDS_ERRORS: Record<string, string> = {
  invalid_input: "Form geçersiz — alanları kontrol et.",
  item_unavailable: "Ürün bulunamadı ya da silinmiş.",
  already_decided: "Bu talep zaten sonuçlanmış (başka bir admin karar vermiş olabilir).",
  not_found: "Talep bulunamadı.",
  account_deleted: "Hesap kalıcı silinmiş — talep yalnız reddedilebilir.",
  already_refunded: "Bu talebin Rainbow'u zaten iade edilmiş — teslim etme, reddet.",
  refund_failed:
    "Talep reddedildi ama iadenin yazılıp yazılmadığı belirsiz. Elle düzeltmeden önce kullanıcının güncel " +
    "Rainbow bakiyesine ve Transactions'ta bu talebin REWARD_REFUND satırına bak (bakiye yazılmış, defter " +
    "satırı düşmüş olabilir); iade yoksa bakiyeyi kullanıcı detayından düzelt.",
  failed: "İşlem başarısız oldu, sunucu loglarına bak.",
};

export const REWARDS_NOTICES: Record<string, string> = {
  saved: "Kaydedildi.",
  deleted: "Ürün silindi.",
  fulfilled: "Talep teslim edildi.",
  rejected: "Talep reddedildi, rainbow iade edildi.",
  rejected_no_refund: "Talep reddedildi (iade yok: hesap silinmiş ya da Rainbow zaten iade edilmiş).",
};

/** Servis hatasını ekran koduna çevirir; beklenmeyen hata loglanır. */
export function rewardsErrorCode(err: unknown, context: string): string {
  if (err instanceof AppError) {
    switch (err.code) {
      case "VALIDATION_ERROR": return "invalid_input";
      case "REWARD_ITEM_UNAVAILABLE": return "item_unavailable";
      case "REWARD_ALREADY_DECIDED": return "already_decided";
      case "REWARD_REDEMPTION_NOT_FOUND": return "not_found";
      case "REWARD_ACCOUNT_PURGED": return "account_deleted";
      case "REWARD_ALREADY_REFUNDED": return "already_refunded";
      case "REWARD_REFUND_FAILED": return "refund_failed";
    }
  }
  console.error(`[Admin] rewards ${context} failed:`, err);
  return "failed";
}

/** Yalnız haritanın KENDİ anahtarı: `?error=constructor` prototip üyesine düşmesin. */
function messageFor(map: Record<string, string>, key: unknown): string | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function flash(req: Request) {
  return {
    error: messageFor(REWARDS_ERRORS, req.query.error),
    notice: messageFor(REWARDS_NOTICES, req.query.notice),
  };
}

/** `:id` uuid değilse null: servis (ve PostgREST'in uuid dönüşüm hatası → 500) hiç çağrılmaz. */
function idParam(req: Request): string | null {
  const parsed = adminIdParamSchema.safeParse(req.params.id);
  return parsed.success ? parsed.data : null;
}

const CATALOG_UNAVAILABLE = "/admin/rewards/catalog?error=item_unavailable";
const REDEMPTION_NOT_FOUND = "/admin/rewards/redemptions?error=not_found";

function issues(error: ZodError): string {
  return error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(" · ");
}

/** Geçersiz formu, admin'in girdiği değerlerle yeniden göstermek için. */
function formValues(body: Record<string, unknown>, id?: string) {
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");
  return {
    id,
    brand_key: text("brand_key"),
    country_code: text("country_code"),
    face_value: text("face_value"),
    cost_usd: text("cost_usd"),
    rainbow_price: text("rainbow_price"),
    sort_order: text("sort_order"),
    logo_url: text("logo_url"),
    is_active: body.is_active === "on",
  };
}

type CatalogFormItem = ReturnType<typeof formValues> | Awaited<ReturnType<typeof rewardsCatalogAdminService.getCatalogItem>>;

class RewardsAdminController {
  async countries(req: Request, res: Response) {
    try {
      const { rainbow } = await economyConfigService.getConfig();
      const [countries, summary] = await Promise.all([
        rewardsCatalogAdminService.listCountries(),
        rewardsQueueService.getSummary(rainbow.suggestedUsdPerRainbow),
      ]);
      res.render("rewards-countries", {
        countries, summary, rules: rainbow, ...flash(req), active: "countries",
        session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] rewards countries failed:", err);
      res.status(500).render("error", { message: "Rainbow Market yüklenemedi.", session: req.session });
    }
  }

  async updateCountry(req: Request, res: Response) {
    const parsed = countrySwitchSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect("/admin/rewards?error=invalid_input");
    try {
      await rewardsCatalogAdminService.updateCountry(String(req.params.code).toUpperCase(), parsed.data);
      res.redirect("/admin/rewards?notice=saved");
    } catch (err) {
      res.redirect(`/admin/rewards?error=${rewardsErrorCode(err, "updateCountry")}`);
    }
  }

  async catalogList(req: Request, res: Response) {
    const filter = adminCatalogQuerySchema.parse(req.query);
    try {
      const [{ rainbow }, page, countries] = await Promise.all([
        economyConfigService.getConfig(),
        rewardsCatalogAdminService.listCatalog(filter),
        rewardsCatalogAdminService.listCountries(),
      ]);
      const items = page.items.map((item) => ({
        ...item,
        suggested_price: suggestedRainbowPrice(item.cost_usd, rainbow.suggestedUsdPerRainbow),
      }));
      res.render("rewards-catalog-list", {
        items, filter, total: page.total, page: page.page,
        totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
        countries, brands: REWARD_BRANDS, ...flash(req), active: "catalog",
        session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] rewards catalogList failed:", err);
      res.status(500).render("error", { message: "Katalog yüklenemedi.", session: req.session });
    }
  }

  async catalogNew(req: Request, res: Response) {
    await this.renderEdit(req, res, null, null);
  }

  async catalogEdit(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(CATALOG_UNAVAILABLE);
    try {
      const item = await rewardsCatalogAdminService.getCatalogItem(id);
      if (!item) return res.redirect(CATALOG_UNAVAILABLE);
      await this.renderEdit(req, res, item, null);
    } catch (err) {
      res.redirect(`/admin/rewards/catalog?error=${rewardsErrorCode(err, "catalogEdit")}`);
    }
  }

  async catalogCreate(req: Request, res: Response) {
    const parsed = catalogItemSchema.safeParse(req.body);
    if (!parsed.success) return this.renderEdit(req, res, formValues(req.body), issues(parsed.error), 400);
    try {
      await rewardsCatalogAdminService.createCatalogItem(parsed.data);
      res.redirect("/admin/rewards/catalog?notice=saved");
    } catch (err) {
      await this.renderEdit(req, res, formValues(req.body), REWARDS_ERRORS[rewardsErrorCode(err, "catalogCreate")], 400);
    }
  }

  async catalogUpdate(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(CATALOG_UNAVAILABLE);
    const parsed = catalogItemSchema.safeParse(req.body);
    if (!parsed.success) return this.renderEdit(req, res, formValues(req.body, id), issues(parsed.error), 400);
    try {
      await rewardsCatalogAdminService.updateCatalogItem(id, parsed.data);
      res.redirect("/admin/rewards/catalog?notice=saved");
    } catch (err) {
      await this.renderEdit(req, res, formValues(req.body, id), REWARDS_ERRORS[rewardsErrorCode(err, "catalogUpdate")], 400);
    }
  }

  async catalogSetActive(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(CATALOG_UNAVAILABLE);
    try {
      await rewardsCatalogAdminService.setCatalogActive(id, req.body.active === "1");
      res.redirect("/admin/rewards/catalog?notice=saved");
    } catch (err) {
      res.redirect(`/admin/rewards/catalog?error=${rewardsErrorCode(err, "catalogSetActive")}`);
    }
  }

  async catalogDelete(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(CATALOG_UNAVAILABLE);
    try {
      await rewardsCatalogAdminService.softDeleteCatalogItem(id);
      res.redirect("/admin/rewards/catalog?notice=deleted");
    } catch (err) {
      res.redirect(`/admin/rewards/catalog?error=${rewardsErrorCode(err, "catalogDelete")}`);
    }
  }

  async redemptions(req: Request, res: Response) {
    const filter = adminRedemptionsQuerySchema.parse(req.query);
    try {
      const [{ rainbow }, page, countries] = await Promise.all([
        economyConfigService.getConfig(),
        rewardsQueueService.listRedemptions(filter),
        rewardsCatalogAdminService.listCountries(),
      ]);
      res.render("rewards-redemptions", {
        rows: page.items, filter, total: page.total, page: page.page,
        totalPages: Math.max(1, Math.ceil(page.total / page.pageSize)),
        monthlyCap: rainbow.monthlyRedeemCap,
        countries, ...flash(req), active: "redemptions",
        session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] rewards redemptions failed:", err);
      res.status(500).render("error", { message: "Talepler yüklenemedi.", session: req.session });
    }
  }

  async fulfill(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(REDEMPTION_NOT_FOUND);
    const parsed = fulfillSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect("/admin/rewards/redemptions?error=invalid_input");
    try {
      await rewardsQueueService.fulfill(id, parsed.data, req.session.adminId!);
      res.redirect("/admin/rewards/redemptions?notice=fulfilled");
    } catch (err) {
      res.redirect(`/admin/rewards/redemptions?error=${rewardsErrorCode(err, "fulfill")}`);
    }
  }

  async reject(req: Request, res: Response) {
    const id = idParam(req);
    if (!id) return res.redirect(REDEMPTION_NOT_FOUND);
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect("/admin/rewards/redemptions?error=invalid_input");
    try {
      const { refunded } = await rewardsQueueService.reject(id, parsed.data.reject_reason, req.session.adminId!);
      res.redirect(`/admin/rewards/redemptions?notice=${refunded ? "rejected" : "rejected_no_refund"}`);
    } catch (err) {
      res.redirect(`/admin/rewards/redemptions?error=${rewardsErrorCode(err, "reject")}`);
    }
  }

  private async renderEdit(req: Request, res: Response, item: CatalogFormItem, error: string | null, status = 200) {
    try {
      const [{ rainbow }, countries] = await Promise.all([
        economyConfigService.getConfig(),
        rewardsCatalogAdminService.listCountries(),
      ]);
      res.status(status).render("rewards-catalog-edit", {
        item, error, countries, brands: REWARD_BRANDS, usdPerRainbow: rainbow.suggestedUsdPerRainbow,
        active: "catalog", notice: null, session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] rewards catalog form failed:", err);
      res.status(500).render("error", { message: "Ürün formu yüklenemedi.", session: req.session });
    }
  }
}

export const rewardsAdminController = new RewardsAdminController();
