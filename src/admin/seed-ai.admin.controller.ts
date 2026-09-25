import type { Request, Response } from "express";
import { supabase } from "../config/supabase.js";
import { previewSeedReply, DenemeHatasi, type DenemeSonucu } from "../services/seed-reply-preview.service.js";
import { SEED_LLM_MODEL, SEED_LLM_PROVIDER } from "../services/seed-llm.service.js";

interface Tur { kim: "insan" | "seed"; text: string }

const GECMIS_TAVANI = 20;
const MESAJ_TAVANI = 500;

/** Hidden alanda tasinan sohbet gecmisi — bozuk/oynanmis girdi sayfayi dusurmemeli. */
function gecmisiCoz(raw: unknown): Tur[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p: unknown = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p
      .filter((t): t is Tur => Boolean(t) && typeof t === "object"
        && ((t as Tur).kim === "insan" || (t as Tur).kim === "seed")
        && typeof (t as Tur).text === "string")
      .slice(-GECMIS_TAVANI)
      .map((t) => ({ kim: t.kim, text: t.text.slice(0, MESAJ_TAVANI) }));
  } catch {
    return [];
  }
}

/**
 * /admin/seed-ai — seed AI sohbet deneme ekrani. Gercek persona kartini kurar, gercek
 * modele sorar, gercek denetimden gecirir; ama HICBIR SEY YAZMAZ. Amac: tonu eslesme
 * kurup cron beklemeden deneme-yanilma ile ayarlamak.
 */
class SeedAiAdminController {
  private async renderPage(req: Request, res: Response, extras: {
    secili?: string; gecmis?: Tur[]; sonuc?: DenemeSonucu | null; error?: string | null;
    phase?: number; busyNow?: boolean;
  } = {}) {
    const { data: profiller } = await supabase
      .from("users")
      .select("id, name, age, city, gender")
      .eq("is_seed_profile", true)
      .order("name")
      .limit(500);

    res.render("seed-ai-deneme", {
      llmProvider: SEED_LLM_PROVIDER,
      llmModel: SEED_LLM_MODEL,
      profiller: profiller ?? [],
      secili: extras.secili ?? "",
      gecmis: extras.gecmis ?? [],
      sonuc: extras.sonuc ?? null,
      error: extras.error ?? null,
      phase: extras.phase ?? 1,
      busyNow: extras.busyNow ?? false,
      session: req.session,
      csrfToken: req.session.csrfToken,
    });
  }

  async page(req: Request, res: Response) {
    try {
      await this.renderPage(req, res);
    } catch (err: any) {
      console.error("[Admin] seed-ai page failed:", err?.message ?? err);
      res.status(500).render("error", { message: "Deneme ekrani yuklenemedi", session: req.session });
    }
  }

  async deneme(req: Request, res: Response) {
    const seedUserId = String(req.body.seedUserId ?? "");
    const yeniMesaj = String(req.body.yeniMesaj ?? "").trim().slice(0, MESAJ_TAVANI);
    const phase = Math.min(4, Math.max(1, parseInt(String(req.body.phase ?? "1"), 10) || 1)) as 1 | 2 | 3 | 4;
    const busyNow = req.body.busyNow === "on";
    const gecmis = gecmisiCoz(req.body.gecmis);

    if (!seedUserId || !yeniMesaj) {
      return this.renderPage(req, res, { secili: seedUserId, gecmis, phase, busyNow, error: "Profil sec ve bir mesaj yaz." });
    }

    const turlar: Tur[] = [...gecmis, { kim: "insan", text: yeniMesaj }];
    try {
      const sonuc = await previewSeedReply({ seedUserId, turns: turlar, phase, busyNow });
      const sonrasi: Tur[] = sonuc.metin ? [...turlar, { kim: "seed", text: sonuc.metin }] : turlar;
      await this.renderPage(req, res, { secili: seedUserId, gecmis: sonrasi, sonuc, phase, busyNow });
    } catch (err: any) {
      const mesaj = err instanceof DenemeHatasi ? err.message : `Model hatasi: ${err?.message ?? err}`;
      console.error("[Admin] seed-ai deneme failed:", err?.message ?? err);
      await this.renderPage(req, res, { secili: seedUserId, gecmis: turlar, phase, busyNow, error: mesaj });
    }
  }
}

export const seedAiAdminController = new SeedAiAdminController();
