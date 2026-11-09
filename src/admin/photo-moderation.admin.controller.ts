import type { Request, Response } from "express";
import { getCheckKind, listChecksForAdmin, resolveCheck, type CheckKind, type Verdict } from "../services/photo-moderation.service.js";
import { resolveQuestionImageCheck } from "../services/question-image-moderation.service.js";

const PAGE_SIZE = 30;
const VERDICTS = new Set<Verdict | "all">(["review", "explicit", "safe", "error", "all"]);
const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Tur basina gecerli aksiyonlar. Soru gorselinde ban YOK (ret = gorsel kaldirilir, soru metinle kalir);
 * kotuye kullanimda ban, kullanici sayfasindaki ayri insan akisidir.
 */
const AKSIYONLAR: Record<CheckKind, ReadonlySet<string>> = {
  profile: new Set(["ban", "safe"]),
  question: new Set(["remove_image", "safe"]),
};
const TUM_AKSIYONLAR = new Set([...AKSIYONLAR.profile, ...AKSIYONLAR.question]);

/** Fotograf moderasyonu review kuyrugu (profil + soru gorseli): modelin kesinlestiremedigini insan karara baglar. */
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
    if (!UUID_DESENI.test(id) || !TUM_AKSIYONLAR.has(action)) {
      res.status(400).render("error", { message: "Invalid moderation action", session: req.session });
      return;
    }
    try {
      const kind = await getCheckKind(id);
      if (kind && !AKSIYONLAR[kind].has(action)) {
        res.status(400).render("error", { message: "Invalid moderation action", session: req.session });
        return;
      }
      const ok = kind === null ? false
        : kind === "question" ? await resolveQuestionImageCheck(id, action as "safe" | "remove_image")
          : await resolveCheck(id, action as "ban" | "safe");
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
