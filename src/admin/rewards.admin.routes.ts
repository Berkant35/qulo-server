import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { superAdminOnly, csrfValidate } from "./admin.middleware.js";
import { rewardsAdminController as c } from "./rewards.admin.controller.js";
import { pageSectionsAdminController as s } from "./page-sections.admin.controller.js";

/**
 * Backoffice "Rainbow Market" (spec §6). Tamamı süper admin: teslim kodları nakit değerinde,
 * ülke anahtarı marketi gerçek kullanıcılara açar. adminAuth + csrfGenerate üst router'da.
 * Sayfa bölümleri (spec 2026-09-28 §6) de burada: /sections…
 */
const router = Router();

router.use(superAdminOnly);

router.get("/", (req, res) => c.countries(req, res));
router.post("/countries/:code", csrfValidate, (req, res) => c.updateCountry(req, res));

router.get("/catalog", (req, res) => c.catalogList(req, res));
router.get("/catalog/new", (req, res) => c.catalogNew(req, res));
router.post("/catalog", csrfValidate, (req, res) => c.catalogCreate(req, res));
router.get("/catalog/:id", (req, res) => c.catalogEdit(req, res));
router.post("/catalog/:id", csrfValidate, (req, res) => c.catalogUpdate(req, res));
router.post("/catalog/:id/active", csrfValidate, (req, res) => c.catalogSetActive(req, res));
router.post("/catalog/:id/delete", csrfValidate, (req, res) => c.catalogDelete(req, res));

router.get("/redemptions", (req, res) => c.redemptions(req, res));
router.post("/redemptions/:id/fulfill", csrfValidate, (req, res) => c.fulfill(req, res));
router.post("/redemptions/:id/reject", csrfValidate, (req, res) => c.reject(req, res));

/** Banner görseli ≤ 8 MB; sunucu ≤ 1440 px JPEG'e indirir (utils/image-normalize). */
const BANNER_MAX_BYTES = 8 * 1024 * 1024;
const bannerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: BANNER_MAX_BYTES, files: 1 } });

/**
 * Kart formu multipart: gövde (csrf token dahil) `csrfValidate`'ten ÖNCE çözülmeli. Boyut/biçim hatası
 * JSON 500 yerine bölüm sayfasına hata olarak döner — bu dalda durum değiştiren hiçbir şey çalışmaz.
 */
function cardForm(req: Request, res: Response, next: NextFunction) {
  bannerUpload.single("image")(req, res, (err: unknown) => {
    if (err) return res.redirect(`/admin/rewards/sections/${encodeURIComponent(String(req.params.id))}?error=image_invalid`);
    next();
  });
}

router.get("/sections", (req, res) => s.list(req, res));
router.get("/sections/new", (req, res) => s.newForm(req, res));
router.post("/sections", csrfValidate, (req, res) => s.create(req, res));
router.get("/sections/:id", (req, res) => s.edit(req, res));
router.post("/sections/:id", csrfValidate, (req, res) => s.update(req, res));
router.post("/sections/:id/status", csrfValidate, (req, res) => s.status(req, res));
router.post("/sections/:id/move", csrfValidate, (req, res) => s.move(req, res));
router.post("/sections/:id/delete", csrfValidate, (req, res) => s.remove(req, res));
router.get("/sections/:id/items/new", (req, res) => s.itemNew(req, res));
router.post("/sections/:id/items", cardForm, csrfValidate, (req, res) => s.itemCreate(req, res));
router.get("/sections/:id/items/:itemId", (req, res) => s.itemEdit(req, res));
router.post("/sections/:id/items/:itemId", cardForm, csrfValidate, (req, res) => s.itemUpdate(req, res));
router.post("/sections/:id/items/:itemId/active", csrfValidate, (req, res) => s.itemActive(req, res));
router.post("/sections/:id/items/:itemId/move", csrfValidate, (req, res) => s.itemMove(req, res));
router.post("/sections/:id/items/:itemId/delete", csrfValidate, (req, res) => s.itemDelete(req, res));

export default router;
