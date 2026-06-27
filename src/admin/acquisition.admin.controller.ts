import type { Request, Response } from "express";
import { acquisitionChannelService } from "../services/acquisition-channel.service.js";
import { createChannelSchema } from "../validators/acquisition-channel.validator.js";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "../constants/locales.js";

function parseLabel(b: Record<string, string>): Record<string, string> {
  const label: Record<string, string> = {};
  for (const l of SUPPORTED_LOCALES) {
    const v = (b[`label_${l}`] ?? "").trim();
    if (v) label[l] = v;
  }
  return label;
}

function buildInput(b: Record<string, string>) {
  return {
    key: (b.key ?? "").trim().toLowerCase(),
    label: parseLabel(b),
    emoji: (b.emoji ?? "").trim() || undefined,
    sort_order: parseInt(b.sort_order) || 0,
    is_active: b.is_active === "on",
    is_freeform: b.is_freeform === "on",
  };
}

class AcquisitionAdminController {
  async list(req: Request, res: Response) {
    try {
      const channels = await acquisitionChannelService.list();
      const report = await acquisitionChannelService.getReport(
        (req.query.from as string) || undefined,
        (req.query.to as string) || undefined,
      );
      res.render("acquisition-list", {
        channels,
        report,
        from: req.query.from ?? "",
        to: req.query.to ?? "",
        localeNames: LOCALE_NAMES,
        session: req.session,
        csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] acquisition list failed:", (err as Error).message);
      res.status(500).render("error", { message: "Kanallar yüklenemedi.", session: req.session });
    }
  }

  async newForm(req: Request, res: Response) {
    res.render("acquisition-edit", {
      channel: null,
      locales: SUPPORTED_LOCALES,
      localeNames: LOCALE_NAMES,
      session: req.session,
      csrfToken: req.session.csrfToken,
    });
  }

  async create(req: Request, res: Response) {
    try {
      const parsed = createChannelSchema.safeParse(buildInput(req.body));
      if (!parsed.success) {
        return res.status(400).render("error", {
          message: parsed.error.errors.map((e) => e.message).join(" · "),
          session: req.session,
        });
      }
      await acquisitionChannelService.create(parsed.data, req.session.adminId!);
      res.redirect("/admin/acquisition");
    } catch (err) {
      console.error("[Admin] acquisition create failed:", (err as Error).message);
      res.status(500).render("error", { message: (err as Error).message, session: req.session });
    }
  }

  async editForm(req: Request, res: Response) {
    const channel = await acquisitionChannelService.getById(req.params.id as string);
    if (!channel) return res.redirect("/admin/acquisition");
    res.render("acquisition-edit", {
      channel,
      locales: SUPPORTED_LOCALES,
      localeNames: LOCALE_NAMES,
      session: req.session,
      csrfToken: req.session.csrfToken,
    });
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
      const parsed = createChannelSchema.safeParse(buildInput(req.body));
      if (!parsed.success) {
        return res.status(400).render("error", {
          message: parsed.error.errors.map((e) => e.message).join(" · "),
          session: req.session,
        });
      }
      await acquisitionChannelService.update(id, parsed.data);
      res.redirect("/admin/acquisition");
    } catch (err) {
      console.error("[Admin] acquisition update failed:", (err as Error).message);
      res.status(500).render("error", { message: (err as Error).message, session: req.session });
    }
  }

  async toggle(req: Request, res: Response) {
    try {
      await acquisitionChannelService.toggleActive(req.params.id as string);
    } catch (err) {
      console.error("[Admin] acquisition toggle failed:", (err as Error).message);
    }
    res.redirect("/admin/acquisition");
  }

  async remove(req: Request, res: Response) {
    try {
      await acquisitionChannelService.softDelete(req.params.id as string);
    } catch (err) {
      console.error("[Admin] acquisition delete failed:", (err as Error).message);
    }
    res.redirect("/admin/acquisition");
  }
}

export const acquisitionAdminController = new AcquisitionAdminController();
