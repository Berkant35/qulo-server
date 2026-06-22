import type { Request, Response } from "express";
import { pageMessageService } from "../services/page-message.service.js";
import { segmentService } from "../services/segment.service.js";
import { createPageMessageSchema } from "../validators/page-message.validator.js";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "../constants/locales.js";
import { PAGE_KEYS } from "../constants/page-keys.js";

function parseSegment(b: Record<string, string>) {
  const s: Record<string, unknown> = {};
  if (b.segment_gender) s.gender = b.segment_gender;
  if (b.segment_age_min) s.age_min = parseInt(b.segment_age_min);
  if (b.segment_age_max) s.age_max = parseInt(b.segment_age_max);
  if (b.segment_cities) s.cities = b.segment_cities.split(",").map((c) => c.trim()).filter(Boolean);
  if (b.segment_is_premium) s.is_premium = b.segment_is_premium === "true";
  if (b.segment_question_count_max) s.question_count_max = parseInt(b.segment_question_count_max);
  return s;
}

function parseContent(b: Record<string, string>) {
  const c: Record<string, { title: string; body: string; cta_label: string }> = {};
  for (const l of SUPPORTED_LOCALES) {
    const title = (b[`title_${l}`] ?? "").trim();
    const body = (b[`body_${l}`] ?? "").trim();
    // Sadece HEM title HEM body dolu olan dilleri al; boş/yarım diller atlanır (mobile fallback'e düşer).
    if (title && body) {
      c[l] = { title, body, cta_label: (b[`cta_${l}`] ?? "").trim() };
    }
  }
  return c;
}

class PageMessageAdminController {
  async list(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const { messages, total } = await pageMessageService.list(page);
      res.render("page-messages-list", {
        messages,
        page,
        totalPages: Math.ceil(total / 20),
        total,
        session: req.session,
        csrfToken: req.session.csrfToken,
      });
    } catch (err: any) {
      console.error("[Admin] page-messages list failed:", err.message);
      res.status(500).render("error", { message: "Mesajlar yüklenemedi.", session: req.session });
    }
  }

  async newForm(req: Request, res: Response) {
    const error = req.session.pageMessageError;
    delete req.session.pageMessageError;
    res.render("page-messages-edit", {
      message: null,
      locales: SUPPORTED_LOCALES,
      localeNames: LOCALE_NAMES,
      pages: PAGE_KEYS,
      session: req.session,
      csrfToken: req.session.csrfToken,
      error: error ?? null,
    });
  }

  async editForm(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const message = await pageMessageService.getById(id);
      if (!message) {
        return res.redirect("/admin/page-messages");
      }
      const error = req.session.pageMessageError;
      delete req.session.pageMessageError;
      res.render("page-messages-edit", {
        message,
        locales: SUPPORTED_LOCALES,
        localeNames: LOCALE_NAMES,
        pages: PAGE_KEYS,
        session: req.session,
        csrfToken: req.session.csrfToken,
        error: error ?? null,
      });
    } catch (err: any) {
      console.error("[Admin] page-messages editForm failed:", err.message);
      res.redirect("/admin/page-messages");
    }
  }

  async create(req: Request, res: Response) {
    try {
      const input = {
        ...req.body,
        content: parseContent(req.body),
        segment: parseSegment(req.body),
        priority: parseInt(req.body.priority) || 0,
        is_active: req.body.is_active === "on",
      };
      const parsed = createPageMessageSchema.safeParse(input);
      if (!parsed.success) {
        req.session.pageMessageError = parsed.error.errors.map((e) => e.message).join(" · ");
        return res.redirect("/admin/page-messages/new");
      }
      await pageMessageService.create(parsed.data, req.session.adminId!);
      res.redirect("/admin/page-messages");
    } catch (err: any) {
      console.error("[Admin] page-messages create failed:", err.message);
      req.session.pageMessageError = err.message;
      res.redirect("/admin/page-messages/new");
    }
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
      const input = {
        ...req.body,
        content: parseContent(req.body),
        segment: parseSegment(req.body),
        priority: parseInt(req.body.priority) || 0,
        is_active: req.body.is_active === "on",
      };
      const parsed = createPageMessageSchema.safeParse(input);
      if (!parsed.success) {
        req.session.pageMessageError = parsed.error.errors.map((e) => e.message).join(" · ");
        return res.redirect(`/admin/page-messages/${id}`);
      }
      await pageMessageService.update(id, parsed.data);
      res.redirect("/admin/page-messages");
    } catch (err: any) {
      console.error("[Admin] page-messages update failed:", err.message);
      req.session.pageMessageError = err.message;
      res.redirect(`/admin/page-messages/${id}`);
    }
  }

  async toggle(req: Request, res: Response) {
    try {
      await pageMessageService.toggleActive(req.params.id as string);
    } catch (err: any) {
      console.error("[Admin] page-messages toggle failed:", err.message);
    }
    res.redirect("/admin/page-messages");
  }

  async remove(req: Request, res: Response) {
    try {
      await pageMessageService.remove(req.params.id as string);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Admin] page-messages remove failed:", err.message);
      res.status(500).json({ error: err.message || "silinemedi" });
    }
  }

  async previewSegment(req: Request, res: Response) {
    try {
      const count = await segmentService.previewSegmentCount(parseSegment(req.body));
      res.json({ count });
    } catch (err: any) {
      console.error("[Admin] page-messages previewSegment failed:", err.message);
      res.status(500).json({ error: err.message || "segment sayısı alınamadı" });
    }
  }
}

export const pageMessageAdminController = new PageMessageAdminController();
