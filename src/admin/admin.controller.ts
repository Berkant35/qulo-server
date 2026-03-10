import type { Request, Response } from "express";
import { adminService } from "./admin.service.js";
import { campaignService } from "../services/campaign.service.js";
import { appConfigService } from "../services/app-config.service.js";
import { supabase } from "../config/supabase.js";

class AdminController {
  loginPage(req: Request, res: Response) {
    if (req.session.adminId) return res.redirect("/admin");
    res.render("login", { error: null, csrfToken: req.session.csrfToken });
  }

  async loginPost(req: Request, res: Response) {
    const { email, password } = req.body;
    const admin = await adminService.validateLogin(email, password);
    if (!admin) {
      return res.render("login", { error: "Invalid credentials", csrfToken: req.session.csrfToken });
    }
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    req.session.adminRole = admin.role;
    res.redirect("/admin");
  }

  logout(req: Request, res: Response) {
    req.session.destroy(() => {
      res.redirect("/admin/login");
    });
  }

  async dashboard(req: Request, res: Response) {
    const stats = await adminService.getDashboardStats();
    res.render("dashboard", { stats, session: req.session });
  }

  async users(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const search = req.query.search as string;
    const gender = req.query.gender as string;
    const { users, total } = await adminService.getUsers(page, 20, search, gender);
    const totalPages = Math.ceil(total / 20);
    res.render("users", { users, page, totalPages, total, search: search || "", gender: gender || "all", session: req.session });
  }

  async userDetail(req: Request, res: Response) {
    const { user, details, questions } = await adminService.getUserDetail(req.params.id as string);
    if (!user) return res.status(404).render("error", { message: "User not found", session: req.session });
    const swipeCount = await adminService.getSwipeCount(req.params.id as string);
    res.render("user-detail", { user, details, questions, swipeCount, session: req.session, csrfToken: req.session.csrfToken });
  }

  async userAction(req: Request, res: Response) {
    const id = req.params.id as string;
    const { action, green_diamonds, purple_diamonds } = req.body;

    if (action === "ban") await adminService.banUser(id);
    else if (action === "unban") await adminService.unbanUser(id);
    else if (action === "delete") await adminService.deleteUser(id);
    else if (action === "update_diamonds") {
      await adminService.updateDiamonds(id, parseInt(green_diamonds), parseInt(purple_diamonds));
    } else if (action === "set_subscription") {
      const { sub_plan, sub_days } = req.body;
      await adminService.setSubscription(id, sub_plan, parseInt(sub_days) || 30);
    } else if (action === "cancel_subscription") {
      await adminService.cancelSubscription(id);
    } else if (action === "reset_swipes") {
      await adminService.resetSwipes(id);
    }

    res.redirect(`/admin/users/${id}`);
  }

  async reports(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const status = req.query.status as string;
    const { reports, total } = await adminService.getReports(page, 20, status);
    const totalPages = Math.ceil(total / 20);
    res.render("reports", { reports, page, totalPages, total, status: status || "all", session: req.session });
  }

  async reportDetail(req: Request, res: Response) {
    const result = await adminService.getReportDetail(req.params.id as string);
    if (!result) return res.status(404).render("error", { message: "Report not found", session: req.session });
    res.render("report-detail", { ...result, session: req.session, csrfToken: req.session.csrfToken });
  }

  async reportAction(req: Request, res: Response) {
    const id = req.params.id as string;
    const { status, ban_user } = req.body;
    await adminService.updateReportStatus(id, status);
    if (ban_user) {
      const detail = await adminService.getReportDetail(id);
      if (detail?.reported) await adminService.banUser(detail.reported.id);
    }
    res.redirect(`/admin/reports/${id}`);
  }

  async matches(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const active = req.query.active as string;
    const { matches, total } = await adminService.getMatches(page, 20, active);
    const totalPages = Math.ceil(total / 20);
    res.render("matches", { matches, page, totalPages, total, active: active || "all", session: req.session });
  }

  async transactions(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const type = req.query.type as string;
    const userId = req.query.userId as string;
    const { transactions, total } = await adminService.getTransactions(page, 30, type, userId);
    const totalPages = Math.ceil(total / 30);
    res.render("transactions", { transactions, page, totalPages, total, type: type || "all", userId: userId || "", session: req.session });
  }

  async quizStats(req: Request, res: Response) {
    const stats = await adminService.getQuizStats();
    res.render("quiz-stats", { stats, session: req.session });
  }

  async admins(req: Request, res: Response) {
    const admins = await adminService.getAdmins();
    res.render("admins", { admins, session: req.session, csrfToken: req.session.csrfToken, error: null });
  }

  async createAdmin(req: Request, res: Response) {
    const { email, password, role } = req.body;
    try {
      await adminService.createAdmin(email, password, role || "ADMIN");
      res.redirect("/admin/admins");
    } catch (e: any) {
      const admins = await adminService.getAdmins();
      res.render("admins", { admins, session: req.session, csrfToken: req.session.csrfToken, error: e.message });
    }
  }

  // ── Campaign management ───────────────────────────────────────────
  async campaigns(req: Request, res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const { campaigns, total } = await campaignService.getCampaigns(page, 20);
    const totalPages = Math.ceil(total / 20);
    res.render("campaigns", { campaigns, page, totalPages, total, session: req.session });
  }

  async campaignNew(req: Request, res: Response) {
    res.render("campaign-new", { session: req.session, csrfToken: req.session.csrfToken });
  }

  async campaignCreate(req: Request, res: Response) {
    const data = req.body;
    const segment: Record<string, any> = {};
    if (data.segment_gender) segment.gender = data.segment_gender;
    if (data.segment_age_min) segment.age_min = parseInt(data.segment_age_min);
    if (data.segment_age_max) segment.age_max = parseInt(data.segment_age_max);
    if (data.segment_cities) segment.cities = data.segment_cities.split(',').map((c: string) => c.trim()).filter(Boolean);
    if (data.segment_subscription) segment.subscription_plan = data.segment_subscription;
    if (data.segment_last_active) segment.last_active_days = parseInt(data.segment_last_active);
    if (data.segment_completion_min) segment.profile_completion_min = parseInt(data.segment_completion_min);
    if (data.segment_completion_max) segment.profile_completion_max = parseInt(data.segment_completion_max);
    if (data.segment_registered_after) segment.registered_after = data.segment_registered_after;

    const campaign = await campaignService.createCampaign({
      title: data.title,
      push_title: data.push_title,
      push_body: data.push_body,
      image_url: data.image_url || undefined,
      action_url: data.action_url || undefined,
      action_label: data.action_label || undefined,
      segment,
      scheduled_at: data.scheduled_at || undefined,
    }, req.session.adminId!);

    res.redirect(`/admin/campaigns/${campaign.id}`);
  }

  async campaignDetail(req: Request, res: Response) {
    const id = req.params.id as string;
    const campaign = await campaignService.getCampaignDetail(id);
    if (!campaign) return res.status(404).render("error", { message: "Campaign not found", session: req.session });
    const breakdown = await campaignService.getCampaignBreakdown(id);
    const error = req.session.campaignError;
    delete req.session.campaignError;
    res.render("campaign-detail", { campaign, breakdown, error, session: req.session, csrfToken: req.session.csrfToken });
  }

  async campaignSend(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
      const result = await campaignService.sendCampaign(id);
      console.log(`[Admin] Campaign ${id} sent:`, result);
    } catch (err: any) {
      console.error(`[Admin] Campaign ${id} send failed:`, err.message);
      // Store error in session flash so detail page can show it
      req.session.campaignError = err.message;
    }
    res.redirect(`/admin/campaigns/${id}`);
  }

  async campaignCancel(req: Request, res: Response) {
    const id = req.params.id as string;
    await campaignService.cancelCampaign(id);
    res.redirect(`/admin/campaigns/${id}`);
  }

  async campaignPreviewCount(req: Request, res: Response) {
    const count = await campaignService.previewSegmentCount(req.body);
    res.json({ count });
  }

  // ── App Config management ───────────────────────────────────────
  async appConfig(req: Request, res: Response) {
    const { data } = await supabase.from("app_config").select("*").limit(1).single();
    res.render("app-config", { config: data, success: req.query.success, session: req.session, csrfToken: req.session.csrfToken });
  }

  async updateAppConfig(req: Request, res: Response) {
    const {
      min_version_ios, min_version_android,
      latest_version_ios, latest_version_android,
      store_url_ios, store_url_android,
      is_maintenance, maintenance_message_tr, maintenance_message_en,
      is_force_update_enabled,
    } = req.body;

    await appConfigService.updateConfig({
      min_version_ios,
      min_version_android,
      latest_version_ios,
      latest_version_android,
      store_url_ios,
      store_url_android,
      is_maintenance: is_maintenance === "on",
      maintenance_message_tr: maintenance_message_tr || null,
      maintenance_message_en: maintenance_message_en || null,
      is_force_update_enabled: is_force_update_enabled === "on",
    });

    res.redirect("/admin/app-config?success=1");
  }

  async deleteAdminAction(req: Request, res: Response) {
    if ((req.params.id as string) === req.session.adminId) {
      return res.redirect("/admin/admins");
    }
    await adminService.deleteAdmin(req.params.id as string);
    res.redirect("/admin/admins");
  }
}

export const adminController = new AdminController();
