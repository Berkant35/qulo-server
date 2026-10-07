import type { Request, Response } from "express";
import { listChecksForAdmin, resolveCheck, type Verdict } from "../services/photo-moderation.service.js";

const PAGE_SIZE = 30;
const VERDICTS = new Set<Verdict | "all">(["review", "explicit", "safe", "error", "all"]);
const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fotograf moderasyonu review kuyrugu: modelin kesinlestiremedigi fotograflari insan karara baglar. */
class PhotoModerationAdminController {
  // Express 4: reddedilen promise errorHandler'a ulasmaz (istek askida kalir) — diger admin sayfalari gibi try/catch.
  async page(req: Request, res: Response): Promise<void> {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const istenen = req.query.verdict as string | undefined;
    const verdict = (VERDICTS.has(istenen as Verdict) ? istenen : "review") as Verdict | "all";
    try {
      const { rows, total } = await listChecksForAdmin(verdict, page, PAGE_SIZE);
      res.render("photo-moderation", {
        rows, total, page, verdict,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[Admin] photo-moderation list failed:", err instanceof Error ? err.message : err);
      res.status(500).render("error", { message: "Failed to load moderation queue", session: req.session });
    }
  }

  async action(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const action = req.body?.action as string;
    if (!UUID_DESENI.test(id) || (action !== "ban" && action !== "safe")) {
      res.status(400).render("error", { message: "Invalid moderation action", session: req.session });
      return;
    }
    try {
      const ok = await resolveCheck(id, action);
      if (!ok) {
        res.status(404).render("error", { message: "Moderation record not found", session: req.session });
        return;
      }
    } catch (err) {
      console.error("[Admin] photo-moderation action failed:", err instanceof Error ? err.message : err);
      res.status(500).render("error", { message: "Moderation action failed", session: req.session });
      return;
    }
    const geri = typeof req.body?.return_to === "string" && req.body.return_to.startsWith("/admin/photo-moderation")
      ? req.body.return_to : "/admin/photo-moderation";
    res.redirect(geri);
  }
}

export const photoModerationAdminController = new PhotoModerationAdminController();
