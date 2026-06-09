import { Router, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../config/supabase.js";
import { emailUnsubscribeTokenService } from "../services/email-unsubscribe-token.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.join(__dirname, "../views/unsubscribe");

export async function unsubscribeHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token ?? "").trim();
  if (!token) {
    res.status(404).render(path.join(viewsDir, "invalid.ejs"));
    return;
  }

  const row = await emailUnsubscribeTokenService.findUnused(token);
  if (!row) {
    res.status(404).render(path.join(viewsDir, "invalid.ejs"));
    return;
  }
  if (row.used_at) {
    res.status(200).render(path.join(viewsDir, "already-done.ejs"));
    return;
  }

  // Mark used + opt out
  await emailUnsubscribeTokenService.markUsed(token);
  await supabase
    .from("users")
    .update({ email_notifications_enabled: false })
    .eq("id", row.user_id);

  res.status(200).render(path.join(viewsDir, "success.ejs"));
}

const router = Router();
router.get("/unsubscribe", unsubscribeHandler);

export default router;
