import type { Request, Response } from "express";
import { whatsNewService, WhatsNewConflictError } from "../services/whats-new.service.js";
import { whatsNewInputSchema, WHATS_NEW_LIMITS, WHATS_NEW_PLATFORMS } from "../validators/whats-new.validator.js";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "../constants/locales.js";

const PER_PAGE = 20;

/** Form alanlarından içerik haritası: başlık, metin ya da düğmesi dolu her dil alınır (eksik yarısı doğrulayıcıda reddedilir). */
export function parseWhatsNewContent(b: Record<string, unknown>) {
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const content: Record<string, { title: string; body: string; cta_label: string }> = {};
  for (const l of SUPPORTED_LOCALES) {
    const title = str(`title_${l}`);
    const body = str(`body_${l}`);
    const cta = str(`cta_${l}`);
    if (title || body || cta) content[l] = { title, body, cta_label: cta };
  }
  return content;
}

/** Form gövdesi -> doğrulanmış girdi. Hata metni admin'e gösterilir. */
export function parseWhatsNewForm(b: Record<string, unknown>) {
  const image = typeof b.image_url === "string" ? b.image_url.trim() : "";
  return whatsNewInputSchema.safeParse({
    app_version: b.app_version,
    platform: b.platform,
    content: parseWhatsNewContent(b),
    image_url: image || null,
    is_active: b.is_active === "on",
  });
}

function errorText(err: unknown): string {
  return err instanceof WhatsNewConflictError ? err.message : "Kaydedilemedi, tekrar dene.";
}

class WhatsNewAdminController {
  async list(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const { items, total } = await whatsNewService.list(page, PER_PAGE);
      const error = req.session.whatsNewError ?? null;
      delete req.session.whatsNewError;
      res.render("whats-new-list", {
        error,
        items: items.map((i) => ({ ...i, localeCount: Object.keys(i.content ?? {}).length })),
        page,
        totalPages: Math.ceil(total / PER_PAGE),
        total,
        localeTotal: SUPPORTED_LOCALES.length,
        session: req.session,
        csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] whats-new list failed:", err);
      res.status(500).render("error", { message: "Yenilikler yüklenemedi.", session: req.session });
    }
  }

  private renderForm(req: Request, res: Response, item: unknown, id: string | null) {
    const error = req.session.whatsNewError;
    delete req.session.whatsNewError;
    res.render("whats-new-edit", {
      item,
      locales: SUPPORTED_LOCALES,
      localeNames: LOCALE_NAMES,
      platforms: WHATS_NEW_PLATFORMS,
      limits: WHATS_NEW_LIMITS,
      session: req.session,
      csrfToken: req.session.csrfToken,
      error: error ?? null,
      id,
    });
  }

  async newForm(req: Request, res: Response) {
    this.renderForm(req, res, null, null);
  }

  async editForm(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const item = await whatsNewService.getById(id);
      if (!item) return res.redirect("/admin/whats-new");
      this.renderForm(req, res, item, id);
    } catch (err) {
      console.error("[Admin] whats-new editForm failed:", err);
      res.redirect("/admin/whats-new");
    }
  }

  async create(req: Request, res: Response) {
    const parsed = parseWhatsNewForm(req.body ?? {});
    if (!parsed.success) {
      req.session.whatsNewError = parsed.error.errors.map((e) => e.message).join(" · ");
      return res.redirect("/admin/whats-new/new");
    }
    try {
      await whatsNewService.create(parsed.data, req.session.adminId!);
      res.redirect("/admin/whats-new");
    } catch (err) {
      console.error("[Admin] whats-new create failed:", err);
      req.session.whatsNewError = errorText(err);
      res.redirect("/admin/whats-new/new");
    }
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;
    const parsed = parseWhatsNewForm(req.body ?? {});
    if (!parsed.success) {
      req.session.whatsNewError = parsed.error.errors.map((e) => e.message).join(" · ");
      return res.redirect(`/admin/whats-new/${id}`);
    }
    try {
      await whatsNewService.update(id, parsed.data);
      res.redirect("/admin/whats-new");
    } catch (err) {
      console.error("[Admin] whats-new update failed:", err);
      req.session.whatsNewError = errorText(err);
      res.redirect(`/admin/whats-new/${id}`);
    }
  }

  async toggle(req: Request, res: Response) {
    try {
      await whatsNewService.toggleActive(req.params.id as string);
    } catch (err) {
      console.error("[Admin] whats-new toggle failed:", err);
      req.session.whatsNewError = errorText(err);
      return res.redirect("/admin/whats-new");
    }
    res.redirect("/admin/whats-new");
  }
}

export const whatsNewAdminController = new WhatsNewAdminController();
