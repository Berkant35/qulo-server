import { Router } from "express";
import { adminController } from "./admin.controller.js";
import { questionBankController } from "./question-bank.controller.js";
import { analyticsController } from "./analytics.controller.js";
import { adminAuth, superAdminOnly, ipWhitelist, csrfGenerate, csrfValidate } from "./admin.middleware.js";
import adminCronRoutes from "./cron.routes.js";
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
router.post("/users/:id/gender-pref", csrfValidate, (req, res) => adminController.updateUserGenderPref(req, res));
router.post("/users/:id/send-notification", csrfValidate, (req, res) => adminController.sendNotification(req, res));
router.post("/users/:id/test-push", csrfValidate, (req, res) => adminController.testPush(req, res));

router.get("/reports", (req, res) => adminController.reports(req, res));
router.get("/reports/:id", (req, res) => adminController.reportDetail(req, res));
router.post("/reports/:id/action", csrfValidate, (req, res) => adminController.reportAction(req, res));

router.get("/matches", (req, res) => adminController.matches(req, res));
router.post("/matches/remove-all", csrfValidate, (req, res) => adminController.removeAllMatches(req, res));

router.get("/transactions", (req, res) => adminController.transactions(req, res));

router.get("/diamond-economy", (req, res) => adminController.diamondEconomy(req, res));

router.get("/quiz-stats", (req, res) => adminController.quizStats(req, res));

router.get("/questions", (req, res) => adminController.questions(req, res));
router.get("/questions/:id", (req, res) => adminController.questionDetail(req, res));
router.post("/questions/:id/action", csrfValidate, (req, res) => adminController.questionAction(req, res));

// Question Bank (AI suggestions)
router.get("/question-bank", (req, res) => questionBankController.page(req, res));
router.get("/question-bank/api", (req, res) => questionBankController.list(req, res));
router.post("/question-bank/api", csrfValidate, (req, res) => questionBankController.create(req, res));
router.post("/question-bank/api/bulk", csrfValidate, (req, res) => questionBankController.bulkCreate(req, res));
router.put("/question-bank/api/:id", csrfValidate, (req, res) => questionBankController.update(req, res));
router.delete("/question-bank/api/:id", csrfValidate, (req, res) => questionBankController.remove(req, res));

router.get("/app-config", (req, res) => adminController.appConfig(req, res));
router.post("/app-config", csrfValidate, (req, res) => adminController.updateAppConfig(req, res));

router.get("/economy-config", (req, res) => adminController.economyConfig(req, res));
router.post("/economy-config", csrfValidate, (req, res) => adminController.updateEconomyConfig(req, res));
router.get("/economy-config/history", (req, res) => adminController.economyConfigHistory(req, res));
router.get("/economy-config/compare", (req, res) => adminController.economyConfigCompare(req, res));

router.get("/campaigns", (req, res) => adminController.campaigns(req, res));
router.get("/campaigns/new", (req, res) => adminController.campaignNew(req, res));
router.post("/campaigns", csrfValidate, (req, res) => adminController.campaignCreate(req, res));
router.get("/campaigns/:id", (req, res) => adminController.campaignDetail(req, res));
router.post("/campaigns/:id/send", csrfValidate, (req, res) => adminController.campaignSend(req, res));
router.post("/campaigns/:id/cancel", csrfValidate, (req, res) => adminController.campaignCancel(req, res));
router.post("/campaigns/preview-count", csrfValidate, (req, res) => adminController.campaignPreviewCount(req, res));

router.get("/tickets", (req, res) => adminController.tickets(req, res));
router.get("/tickets/:id", (req, res) => adminController.ticketDetail(req, res));
router.post("/tickets/:id/reply", csrfValidate, (req, res) => adminController.ticketReply(req, res));

router.get("/analytics", (req, res) => analyticsController.page(req, res));
router.get("/analytics/api", (req, res) => analyticsController.apiData(req, res));
router.get("/analytics/export", (req, res) => analyticsController.exportCsv(req, res));

router.get("/blocks", (req, res) => adminController.blocks(req, res));

router.get("/admins", superAdminOnly, (req, res) => adminController.admins(req, res));
router.post("/admins", superAdminOnly, csrfValidate, (req, res) => adminController.createAdmin(req, res));
router.post("/admins/:id/delete", superAdminOnly, csrfValidate, (req, res) => adminController.deleteAdminAction(req, res));

// Cron management (JSON API)
router.use("/crons", adminCronRoutes);

export default router;
