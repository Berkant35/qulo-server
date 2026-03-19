import { Router } from "express";
import { adminController } from "./admin.controller.js";
import { adminAuth, superAdminOnly, ipWhitelist, csrfGenerate, csrfValidate } from "./admin.middleware.js";
import rateLimit from "express-rate-limit";

const router = Router();

router.use(ipWhitelist);

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: "Too many login attempts. Try again in 15 minutes.",
});

// Public
router.get("/login", csrfGenerate, (req, res) => adminController.loginPage(req, res));
router.post("/login", adminLoginLimiter, csrfValidate, (req, res) => adminController.loginPost(req, res));

// Protected
router.use(adminAuth);
router.use(csrfGenerate);

router.get("/logout", (req, res) => adminController.logout(req, res));
router.get("/", (req, res) => adminController.dashboard(req, res));

router.get("/users", (req, res) => adminController.users(req, res));
router.get("/users/:id", (req, res) => adminController.userDetail(req, res));
router.post("/users/:id/action", csrfValidate, (req, res) => adminController.userAction(req, res));
router.post("/users/:id/send-notification", csrfValidate, (req, res) => adminController.sendNotification(req, res));

router.get("/reports", (req, res) => adminController.reports(req, res));
router.get("/reports/:id", (req, res) => adminController.reportDetail(req, res));
router.post("/reports/:id/action", csrfValidate, (req, res) => adminController.reportAction(req, res));

router.get("/matches", (req, res) => adminController.matches(req, res));

router.get("/transactions", (req, res) => adminController.transactions(req, res));

router.get("/quiz-stats", (req, res) => adminController.quizStats(req, res));

router.get("/app-config", (req, res) => adminController.appConfig(req, res));
router.post("/app-config", csrfValidate, (req, res) => adminController.updateAppConfig(req, res));

router.get("/campaigns", (req, res) => adminController.campaigns(req, res));
router.get("/campaigns/new", (req, res) => adminController.campaignNew(req, res));
router.post("/campaigns", csrfValidate, (req, res) => adminController.campaignCreate(req, res));
router.get("/campaigns/:id", (req, res) => adminController.campaignDetail(req, res));
router.post("/campaigns/:id/send", csrfValidate, (req, res) => adminController.campaignSend(req, res));
router.post("/campaigns/:id/cancel", csrfValidate, (req, res) => adminController.campaignCancel(req, res));
router.post("/campaigns/preview-count", csrfValidate, (req, res) => adminController.campaignPreviewCount(req, res));

router.get("/admins", superAdminOnly, (req, res) => adminController.admins(req, res));
router.post("/admins", superAdminOnly, csrfValidate, (req, res) => adminController.createAdmin(req, res));
router.post("/admins/:id/delete", superAdminOnly, csrfValidate, (req, res) => adminController.deleteAdminAction(req, res));

export default router;
