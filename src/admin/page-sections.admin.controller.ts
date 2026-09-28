import type { Request, Response } from "express";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../constants/locales.js";
import { APP_ROUTES, REWARDS_MARKET_PAGE, SECTION_LIMITS, TARGET_PLATFORMS } from "../utils/page-sections.js";
import { pageSectionsAdminService, type AdminSection, type AdminSectionItem } from "../services/page-sections-admin.service.js";
import { pageSectionEventsService, type ItemStats } from "../services/page-section-events.service.js";
import { rewardsCatalogAdminService } from "../services/rewards-catalog-admin.service.js";
import {
  bannerItemFormSchema,
  featuredItemFormSchema,
  moveSchema,
  sectionFormSchema,
  sectionStatsQuerySchema,
  sectionStatusSchema,
} from "../validators/page-sections.validator.js";
import { flashMessage, uuidParam, zodIssues } from "./admin-form.js";
import {
  APP_ROUTE_LABELS, productLabel, SECTIONS_ERRORS, SECTIONS_NOTICES, sectionItemRows, sectionsErrorCode, targetingSummary,
  type SectionItemRowView,
} from "./page-sections.admin.view.js";

const LIST = "/admin/rewards/sections";
const NOT_FOUND = `${LIST}?error=not_found`;

function flash(req: Request) {
  return {
    error: flashMessage(SECTIONS_ERRORS, req.query.error),
    notice: flashMessage(SECTIONS_NOTICES, req.query.notice),
  };
}

function shared(req: Request) {
  return {
    active: "sections",
    session: req.session,
    csrfToken: req.session.csrfToken,
    locales: SUPPORTED_LOCALES,
    localeNames: LOCALE_NAMES,
    platforms: TARGET_PLATFORMS,
    appRoutes: APP_ROUTES,
    routeLabels: APP_ROUTE_LABELS,
    limits: SECTION_LIMITS,
  };
}

type Found = { section: AdminSection; items: AdminSectionItem[] };
const sectionPage = (id: string) => `${LIST}/${id}`;

class PageSectionsAdminController {
  async list(req: Request, res: Response) {
    try {
      const sections = await pageSectionsAdminService.listSections(REWARDS_MARKET_PAGE);
      res.render("rewards-sections-list", {
        sections: sections.map((s) => ({ ...s, targeting: targetingSummary(s) })),
        ...flash(req),
        ...shared(req),
      });
    } catch (err) {
      console.error("[Admin] page sections list failed:", err);
      res.status(500).render("error", { message: "Sayfa bölümleri yüklenemedi.", session: req.session });
    }
  }

  async newForm(req: Request, res: Response) {
    await this.renderSection(req, res, null, null, null);
  }

  async create(req: Request, res: Response) {
    const parsed = sectionFormSchema.safeParse(req.body);
    if (!parsed.success) return this.renderSection(req, res, null, req.body, zodIssues(parsed.error), 400);
    try {
      const section = await pageSectionsAdminService.createSection(REWARDS_MARKET_PAGE, parsed.data, req.session.adminId!);
      res.redirect(`${sectionPage(section.id)}?notice=saved`);
    } catch (err) {
      await this.renderSection(req, res, null, req.body, SECTIONS_ERRORS[sectionsErrorCode(err, "create")], 400);
    }
  }

  async edit(req: Request, res: Response) {
    const id = uuidParam(req.params.id);
    if (!id) return res.redirect(NOT_FOUND);
    try {
      const found = await pageSectionsAdminService.getSection(id);
      if (!found) return res.redirect(NOT_FOUND);
      await this.renderSection(req, res, found, null, null);
    } catch (err) {
      res.redirect(`${LIST}?error=${sectionsErrorCode(err, "edit")}`);
    }
  }

  async update(req: Request, res: Response) {
    const id = uuidParam(req.params.id);
    if (!id) return res.redirect(NOT_FOUND);
    const parsed = sectionFormSchema.safeParse(req.body);
    try {
      if (!parsed.success) {
        const found = await pageSectionsAdminService.getSection(id);
        if (!found) return res.redirect(NOT_FOUND);
        return this.renderSection(req, res, found, req.body, zodIssues(parsed.error), 400);
      }
      await pageSectionsAdminService.updateSection(id, parsed.data);
      res.redirect(`${sectionPage(id)}?notice=saved`);
    } catch (err) {
      res.redirect(`${sectionPage(id)}?error=${sectionsErrorCode(err, "update")}`);
    }
  }

  async status(req: Request, res: Response) {
    const id = uuidParam(req.params.id);
    if (!id) return res.redirect(NOT_FOUND);
    const parsed = sectionStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect(`${LIST}?error=invalid_input`);
    try {
      await pageSectionsAdminService.setSectionStatus(id, parsed.data.status);
      res.redirect(`${LIST}?notice=${parsed.data.status === "published" ? "published" : "drafted"}`);
    } catch (err) {
      res.redirect(`${LIST}?error=${sectionsErrorCode(err, "status")}`);
    }
  }

  async move(req: Request, res: Response) {
    const id = uuidParam(req.params.id);
    if (!id) return res.redirect(NOT_FOUND);
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect(`${LIST}?error=invalid_input`);
    try {
      await pageSectionsAdminService.moveSection(id, parsed.data.direction);
      res.redirect(`${LIST}?notice=saved`);
    } catch (err) {
      res.redirect(`${LIST}?error=${sectionsErrorCode(err, "move")}`);
    }
  }

  async remove(req: Request, res: Response) {
    const id = uuidParam(req.params.id);
    if (!id) return res.redirect(NOT_FOUND);
    try {
      await pageSectionsAdminService.softDeleteSection(id);
      res.redirect(`${LIST}?notice=deleted`);
    } catch (err) {
      res.redirect(`${LIST}?error=${sectionsErrorCode(err, "remove")}`);
    }
  }

  async itemNew(req: Request, res: Response) {
    const found = await this.loadForItem(req, res);
    if (found) await this.renderItem(req, res, found.section, null, null, null);
  }

  async itemEdit(req: Request, res: Response) {
    const found = await this.loadForItem(req, res);
    if (!found) return;
    const item = found.items.find((i) => i.id === uuidParam(req.params.itemId));
    if (!item) return res.redirect(`${sectionPage(found.section.id)}?error=not_found`);
    await this.renderItem(req, res, found.section, item, null, null);
  }

  async itemCreate(req: Request, res: Response) {
    const found = await this.loadForItem(req, res);
    if (found) await this.saveItem(req, res, found, null);
  }

  async itemUpdate(req: Request, res: Response) {
    const found = await this.loadForItem(req, res);
    if (!found) return;
    const item = found.items.find((i) => i.id === uuidParam(req.params.itemId));
    if (!item) return res.redirect(`${sectionPage(found.section.id)}?error=not_found`);
    await this.saveItem(req, res, found, item);
  }

  async itemActive(req: Request, res: Response) {
    await this.itemAction(req, res, "itemActive", (sectionId, itemId) =>
      pageSectionsAdminService.setItemActive(sectionId, itemId, req.body.active === "1"), "saved");
  }

  async itemMove(req: Request, res: Response) {
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect(`${LIST}?error=invalid_input`);
    await this.itemAction(req, res, "itemMove", (sectionId, itemId) =>
      pageSectionsAdminService.moveItem(sectionId, itemId, parsed.data.direction), "saved");
  }

  async itemDelete(req: Request, res: Response) {
    await this.itemAction(req, res, "itemDelete", (sectionId, itemId) =>
      pageSectionsAdminService.deleteItem(sectionId, itemId), "deleted");
  }

  // ── yardımcılar ──────────────────────────────────────────────────────

  private async itemAction(
    req: Request,
    res: Response,
    context: string,
    action: (sectionId: string, itemId: string) => Promise<void>,
    notice: "saved" | "deleted",
  ) {
    const sectionId = uuidParam(req.params.id);
    const itemId = uuidParam(req.params.itemId);
    if (!sectionId || !itemId) return res.redirect(NOT_FOUND);
    try {
      await action(sectionId, itemId);
      res.redirect(`${sectionPage(sectionId)}?notice=${notice}`);
    } catch (err) {
      res.redirect(`${sectionPage(sectionId)}?error=${sectionsErrorCode(err, context)}`);
    }
  }

  /** Bölümü okur; yoksa yönlendirir ve null döner (çağıran yalnız null değilse devam eder). */
  private async loadForItem(req: Request, res: Response): Promise<Found | null> {
    const sectionId = uuidParam(req.params.id);
    if (!sectionId) {
      res.redirect(NOT_FOUND);
      return null;
    }
    try {
      const found = await pageSectionsAdminService.getSection(sectionId);
      if (!found) res.redirect(NOT_FOUND);
      return found;
    } catch (err) {
      res.redirect(`${LIST}?error=${sectionsErrorCode(err, "loadForItem")}`);
      return null;
    }
  }

  private async saveItem(req: Request, res: Response, found: Found, item: AdminSectionItem | null) {
    const { section } = found;
    const image = req.file?.buffer ?? null;
    try {
      if (section.section_type === "banner_carousel") {
        const parsed = bannerItemFormSchema.safeParse(req.body);
        if (!parsed.success) return this.renderItem(req, res, section, item, req.body, zodIssues(parsed.error), 400);
        if (item) await pageSectionsAdminService.updateBannerItem(section.id, item.id, parsed.data, image);
        else await pageSectionsAdminService.createBannerItem(section.id, parsed.data, image);
      } else {
        const parsed = featuredItemFormSchema.safeParse(req.body);
        if (!parsed.success) return this.renderItem(req, res, section, item, req.body, zodIssues(parsed.error), 400);
        if (item) await pageSectionsAdminService.updateFeaturedItem(section.id, item.id, parsed.data);
        else await pageSectionsAdminService.createFeaturedItem(section.id, parsed.data);
      }
      res.redirect(`${sectionPage(section.id)}?notice=saved`);
    } catch (err) {
      await this.renderItem(req, res, section, item, req.body, SECTIONS_ERRORS[sectionsErrorCode(err, "saveItem")], 400);
    }
  }

  private async renderSection(
    req: Request,
    res: Response,
    found: Found | null,
    form: Record<string, unknown> | null,
    error: string | null,
    status = 200,
  ) {
    try {
      const countries = await rewardsCatalogAdminService.listCountries();
      let items: SectionItemRowView[] = [];
      let statsError: string | null = null;
      const { days } = sectionStatsQuerySchema.parse(req.query);
      if (found) {
        let stats = new Map<string, ItemStats>();
        try {
          stats = await pageSectionEventsService.stats(REWARDS_MARKET_PAGE, days);
        } catch (err) {
          console.error("[Admin] page sections stats failed:", err);
          statsError = "İstatistik okunamadı — sayılar geçici olarak 0 görünüyor.";
        }
        const products = new Map((await pageSectionsAdminService.catalogOptions(null)).map((o) => [o.id, productLabel(o)]));
        items = sectionItemRows(found.items, stats, products);
      }
      const messages = flash(req);
      res.status(status).render("rewards-section-edit", {
        section: found?.section ?? null,
        items,
        form,
        error: error ?? messages.error,
        notice: error ? null : messages.notice,
        countries,
        days,
        statsError,
        ...shared(req),
      });
    } catch (err) {
      console.error("[Admin] page section form failed:", err);
      res.status(500).render("error", { message: "Bölüm formu yüklenemedi.", session: req.session });
    }
  }

  private async renderItem(
    req: Request,
    res: Response,
    section: AdminSection,
    item: AdminSectionItem | null,
    form: Record<string, unknown> | null,
    error: string | null,
    status = 200,
  ) {
    try {
      const [options, countries] = await Promise.all([
        pageSectionsAdminService.catalogOptions(section.countries),
        rewardsCatalogAdminService.listCountries(),
      ]);
      const labelled = options.map((o) => ({ ...o, label: productLabel(o) }));
      res.status(status).render("rewards-section-item-edit", {
        section, item, form, error, notice: null, options: labelled, countries, ...shared(req),
      });
    } catch (err) {
      console.error("[Admin] page section item form failed:", err);
      res.status(500).render("error", { message: "Kart formu yüklenemedi.", session: req.session });
    }
  }
}

export const pageSectionsAdminController = new PageSectionsAdminController();
