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
  if (b.segment_subscription) s.subscription_plan = b.segment_subscription;
  if (b.segment_is_premium) s.is_premium = b.segment_is_premium === "true";
  if (b.segment_question_count_max) s.question_count_max = parseInt(b.segment_question_count_max);
  return s;
}

function parseContent(b: Record<string, string>) {
  const c: Record<string, { title: string; body: string; cta_label: string }> = {};
  for (const l of SUPPORTED_LOCALES) {
    c[l] = { title: b[`title_${l}`] ?? "", body: b[`body_${l}`] ?? "", cta_label: b[`cta_${l}`] ?? "" };
  }
  return c;
}

class PageMessageAdminController {
  async list(req: Request, res: Response) {
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
    const id = req.params.id as string;
    const message = await pageMessageService.getById(id);
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
  }

  async create(req: Request, res: Response) {
    const input = {
      ...req.body,
      content: parseContent(req.body),
      segment: parseSegment(req.body),
      priority: parseInt(req.body.priority) || 0,
      is_active: req.body.is_active === "on",
    };
    const parsed = createPageMessageSchema.safeParse(input);
    if (!parsed.success) {
      req.session.pageMessageError = JSON.stringify(parsed.error.flatten().fieldErrors);
      return res.redirect("/admin/page-messages/new");
    }
    await pageMessageService.create(parsed.data, req.session.adminId!);
    res.redirect("/admin/page-messages");
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;
    const input = {
      ...req.body,
      content: parseContent(req.body),
      segment: parseSegment(req.body),
      priority: parseInt(req.body.priority) || 0,
      is_active: req.body.is_active === "on",
    };
    const parsed = createPageMessageSchema.safeParse(input);
    if (!parsed.success) {
      req.session.pageMessageError = JSON.stringify(parsed.error.flatten().fieldErrors);
      return res.redirect(`/admin/page-messages/${id}`);
    }
    await pageMessageService.update(id, parsed.data);
    res.redirect("/admin/page-messages");
  }

  async toggle(req: Request, res: Response) {
    await pageMessageService.toggleActive(req.params.id as string);
    res.redirect("/admin/page-messages");
  }

  async remove(req: Request, res: Response) {
    await pageMessageService.remove(req.params.id as string);
    res.json({ ok: true });
  }

  async previewSegment(req: Request, res: Response) {
    const count = await segmentService.previewSegmentCount(parseSegment(req.body));
    res.json({ count });
  }
}

export const pageMessageAdminController = new PageMessageAdminController();
