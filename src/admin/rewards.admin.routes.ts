import { Router } from "express";
import { superAdminOnly, csrfValidate } from "./admin.middleware.js";
import { rewardsAdminController as c } from "./rewards.admin.controller.js";

/**
 * Backoffice "Rainbow Market" (spec §6). Tamamı süper admin: teslim kodları nakit değerinde,
 * ülke anahtarı marketi gerçek kullanıcılara açar. adminAuth + csrfGenerate üst router'da.
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

export default router;
