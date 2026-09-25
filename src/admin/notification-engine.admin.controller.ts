import type { Request, Response } from "express";
import {
  loadEngineConfig,
  saveEngineConfig,
  runEngine,
  getEngineStats,
  summarizeDecisions,
  LIFECYCLE_RULES,
} from "../services/notification-engine/index.js";
import type { EngineRunResult } from "../services/notification-engine/index.js";
import { parseEngineConfigForm } from "../validators/notification-engine.validator.js";

interface PageExtras {
  preview?: EngineRunResult | null;
  error?: string | null;
  success?: string | null;
}

/**
 * /admin/notification-engine — motorun tek ekrani: ayarlar (ac/kapa, dry-run, saat, tavanlar,
 * kural basina ac/kapa + dizi), onizleme (simulasyon), kural istatistigi, son kosumlar, son kayitlar.
 */
class NotificationEngineAdminController {
  private async renderPage(req: Request, res: Response, extras: PageExtras = {}) {
    const [loaded, stats] = await Promise.all([loadEngineConfig(), getEngineStats()]);
    const preview = extras.preview ?? null;
    res.render("notification-engine", {
      loaded,
      config: loaded.config,
      stats,
      rules: LIFECYCLE_RULES,
      preview,
      previewCounts: preview ? summarizeDecisions(preview.decisions) : null,
      error: extras.error ?? null,
      success: extras.success ?? null,
      session: req.session,
      csrfToken: req.session.csrfToken,
    });
  }

  async page(req: Request, res: Response) {
    try {
      await this.renderPage(req, res, {
        success: req.query.success ? "Ayarlar kaydedildi." : null,
        error: typeof req.query.error === "string" ? req.query.error : null,
      });
    } catch (err: any) {
      console.error("[Admin] notification-engine load failed:", err?.message ?? err);
      res.status(500).render("error", { message: "Bildirim motoru sayfasi yuklenemedi", session: req.session });
    }
  }

  async save(req: Request, res: Response) {
    try {
      const loaded = await loadEngineConfig();
      if (loaded.tableMissing) {
        return res.redirect("/admin/notification-engine?error=" + encodeURIComponent("Once migration 045 uygulanmali"));
      }
      if (loaded.loadError) {
        return res.redirect("/admin/notification-engine?error=" + encodeURIComponent("Ayar okunamadi, tekrar dene: " + loaded.loadError));
      }
      const parsed = parseEngineConfigForm(req.body ?? {}, loaded.config);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const shown = issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
        const detail = shown.join("; ") + (issues.length > 5 ? ` (+${issues.length - 5} hata daha)` : "");
        return res.redirect("/admin/notification-engine?error=" + encodeURIComponent(detail));
      }
      await saveEngineConfig(parsed.data, req.session.adminEmail ?? "admin");
      res.redirect("/admin/notification-engine?success=1");
    } catch (err: any) {
      console.error("[Admin] notification-engine save failed:", err?.message ?? err);
      res.redirect("/admin/notification-engine?error=" + encodeURIComponent(err?.message || "Kaydedilemedi"));
    }
  }

  /** Simulasyon: pencere ve gunluk kontrol yok, gonderim yok, kayit yok — "su an kime ne giderdi". */
  async preview(req: Request, res: Response) {
    try {
      const preview = await runEngine("simulate");
      await this.renderPage(req, res, { preview });
    } catch (err: any) {
      console.error("[Admin] notification-engine preview failed:", err?.message ?? err);
      await this.renderPage(req, res, { error: err?.message || "Onizleme basarisiz" }).catch(() => {
        res.status(500).render("error", { message: "Onizleme basarisiz", session: req.session });
      });
    }
  }
}

export const notificationEngineAdminController = new NotificationEngineAdminController();
