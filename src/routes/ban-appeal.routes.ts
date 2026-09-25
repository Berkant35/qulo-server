import { Router, type Request, type Response } from "express";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPEAL_MESSAGE_MAX, banService } from "../services/ban.service.js";
import { emailLinkLimiter } from "../middleware/rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.join(__dirname, "../views/ban-appeal");

function sayfa(res: Response, kod: number, ad: "form" | "submitted" | "invalid", data?: Record<string, unknown>): void {
  res.status(kod).render(path.join(viewsDir, `${ad}.ejs`), data);
}

/** GET /ban-appeal?token= — e-postadaki baglanti; pending ise form, degilse durum sayfasi. */
export async function banAppealFormHandler(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.query.token ?? "").trim();
    const row = token ? await banService.findAppeal(token) : null;
    // resolved (admin unban etti, itiraz hic gonderilmedi) -> baglanti artik anlamsiz
    if (!row || row.status === "resolved") return sayfa(res, 404, "invalid");
    if (row.status === "submitted") return sayfa(res, 200, "submitted");
    sayfa(res, 200, "form", { token, maxLength: APPEAL_MESSAGE_MAX });
  } catch (err) {
    // Express 4 async reddi yakalamaz — asili istek yerine sayfa.
    console.error("[ban-appeal] form error:", err instanceof Error ? err.message : err);
    sayfa(res, 500, "invalid");
  }
}

/** POST /ban-appeal — tek kullanimlik token; basarida admin'e e-posta gider. Tekrar = ayni sayfa (idempotent). */
export async function banAppealSubmitHandler(req: Request, res: Response): Promise<void> {
  try {
    const token = String(req.body?.token ?? "").trim();
    const message = String(req.body?.message ?? "");
    if (!token) return sayfa(res, 404, "invalid");
    if (await banService.submitAppeal(token, message)) return sayfa(res, 200, "submitted");
    // pending degil: zaten gonderilmis (submitted sayfasi) ya da token yok (invalid)
    const row = await banService.findAppeal(token);
    const gonderilmis = row?.status === "submitted";
    sayfa(res, gonderilmis ? 200 : 404, gonderilmis ? "submitted" : "invalid");
  } catch (err) {
    console.error("[ban-appeal] submit error:", err instanceof Error ? err.message : err);
    sayfa(res, 500, "invalid");
  }
}

const router = Router();
router.get("/ban-appeal", emailLinkLimiter, banAppealFormHandler);
// Mesaj sunucuda 1000 karaktere kirpilir; parse siniri onun ustunde, 100 kB varsayilaninin cok altinda.
router.post("/ban-appeal", emailLinkLimiter, express.urlencoded({ extended: false, limit: "4kb" }), banAppealSubmitHandler);

export default router;
