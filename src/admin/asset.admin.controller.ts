import type { Request, Response } from "express";
import { assetService } from "../services/asset.service.js";

class AssetAdminController {
  async page(req: Request, res: Response) {
    try {
      const assets = await assetService.list();
      const error = req.session.assetError;
      delete req.session.assetError;
      res.render("assets", {
        assets,
        session: req.session,
        csrfToken: req.session.csrfToken,
        error: error ?? null,
      });
    } catch (err: any) {
      console.error("[Admin] assets list failed:", err.message);
      res.status(500).render("error", { message: "Varlıklar yüklenemedi.", session: req.session });
    }
  }

  async upload(req: Request, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        req.session.assetError = "Dosya seçilmedi.";
        return res.redirect("/admin/assets");
      }
      await assetService.upload(file.buffer, file.originalname, file.mimetype);
      res.redirect("/admin/assets");
    } catch (err: any) {
      console.error("[Admin] asset upload failed:", err.message);
      req.session.assetError = err.message || "Yükleme başarısız.";
      res.redirect("/admin/assets");
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const name = (req.body.name as string)?.trim();
      if (!name) {
        return res.status(400).json({ error: "isim gerekli" });
      }
      await assetService.remove(name);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Admin] asset remove failed:", err.message);
      res.status(500).json({ error: err.message || "silinemedi" });
    }
  }
}

export const assetAdminController = new AssetAdminController();
