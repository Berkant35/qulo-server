import type { Request, Response } from "express";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../constants/locales.js";
import { adminService, pushTemplateAdminService } from "./admin.service.js";
import { emailService } from "../services/email.service.js";
import { appConfigService } from "../services/app-config.service.js";
import { NotificationService, type PushType } from "../services/notification.service.js";
import { economyConfigService } from "../services/economy-config.service.js";
import { economyConfigSchema, ECONOMY_BOUNDARIES } from "../types/economy-config.schema.js";
import { supabase } from "../config/supabase.js";
import { isUuid } from "../utils/validation.js";
import { rewardsQueueService } from "../services/rewards-queue.service.js";
import {
  pushTemplateParamsSchema,
  pushTemplateQuerySchema,
  pushTemplateBodySchema,
} from "../validators/push-template.validator.js";

/** Para ve görünürlük değiştiren kullanıcı eylemleri yalnız süper admin (Rainbow Plan 2). */
const SUPER_ADMIN_USER_ACTIONS = new Set(["update_diamonds", "test_admin_on", "test_admin_off", "clear_rainbow_flag"]);

/** Kullanıcı detayındaki `?error=` kodu → mesaj (backoffice Türkçe). */
const USER_ACTION_ERRORS: Record<string, string> = {
  forbidden: "Bu işlem yalnız süper admin içindir.",
  invalid_diamonds: "Elmas değerleri 0 ya da pozitif tam sayı olmalı.",
  update_failed: "Bakiye güncellenemedi (eşzamanlı bir değişiklik olmuş olabilir) — sayfayı yenileyip tekrar dene.",
  action_failed: "İşlem başarısız oldu, sunucu loglarına bak.",
};

/** Yalnız haritanın KENDİ anahtarı: `?error=constructor` prototip üyesine düşmesin. */
function userActionError(key: unknown): string | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(USER_ACTION_ERRORS, key)
    ? USER_ACTION_ERRORS[key]
    : null;
}

/**
 * HTML checkbox semantics: present + "on" -> true, present but unchecked -> false.
 * Absent entirely -> undefined, meaning "leave this column alone".
 *
 * Needed for fields the EJS form does not render (the seed AI kill-switches): treating
 * absence as "off" would silently disable a live cron every time any other app-config
 * setting is saved. `undefined` never reaches the PostgREST body, so the column is kept.
 */
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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const search = req.query.search as string;
    const gender = req.query.gender as string;
    const { users, total } = await adminService.getUsers(page, 20, search, gender);
    const totalPages = Math.ceil(total / 20);
    res.render("users", { users, page, totalPages, total, search: search || "", gender: gender || "all", session: req.session });
  }

  async userDetail(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
      const { user, details, questions } = await adminService.getUserDetail(id);
      if (!user) return res.status(404).render("error", { message: "User not found", session: req.session });
      const swipeCount = await adminService.getSwipeCount(id);
      res.render("user-detail", {
        user, details, questions, swipeCount,
        error: userActionError(req.query.error),
        session: req.session, csrfToken: req.session.csrfToken,
      });
    } catch (err) {
      console.error("[admin] userDetail failed:", { userId: id, err });
      res.status(500).render("error", { message: "Kullanıcı yüklenemedi.", session: req.session });
    }
  }

  async userAction(req: Request, res: Response) {
    const id = req.params.id as string;
    const { action } = req.body;

    if (SUPER_ADMIN_USER_ACTIONS.has(action) && req.session.adminRole !== "SUPER_ADMIN") {
      return res.redirect(`/admin/users/${id}?error=forbidden`);
    }
    if (action === "update_diamonds") return this.updateDiamondsAction(req, res, id);

    try {
      if (action === "ban") await adminService.banUser(id);
      else if (action === "unban") await adminService.unbanUser(id);
      else if (action === "delete") await adminService.deleteUser(id);
      else if (action === "set_subscription") {
        const { sub_plan, sub_days } = req.body;
        await adminService.setSubscription(id, sub_plan, parseInt(sub_days) || 30);
      } else if (action === "cancel_subscription") await adminService.cancelSubscription(id);
      else if (action === "reset_swipes") await adminService.resetSwipes(id);
      else if (action === "reset_discovery") await adminService.resetUserDiscovery(id);
      else if (action === "test_admin_on" || action === "test_admin_off") {
        await adminService.setTestAdmin(id, action === "test_admin_on");
      } else if (action === "clear_rainbow_flag") await rewardsQueueService.clearRainbowFlag(id);
    } catch (err) {
      // Eskiden yalnız update_diamonds yakalanıyordu: diğer dallar patlayınca istek asılı kalıyordu.
      console.error(`[admin] userAction ${action} failed:`, { userId: id, err });
      return res.redirect(`/admin/users/${id}?error=action_failed`);
    }

    res.redirect(`/admin/users/${id}`);
  }

  /** Alan yok/boş = "değişmedi" (0 DEĞİL); negatif/NaN servise gitmez. */
  private async updateDiamondsAction(req: Request, res: Response, id: string) {
    const green = parseInt(req.body.green_diamonds);
    const purple = parseInt(req.body.purple_diamonds);
    // Alan yok/boş = "değişmedi" (0 DEĞİL): eski form ya da eksik alan rainbow'u sıfırlamasın.
    const rawRainbow = req.body.rainbow_diamonds;
    const rainbow = rawRainbow == null || String(rawRainbow).trim() === "" ? undefined : parseInt(String(rawRainbow));
    if ([green, purple, rainbow].some((n) => n !== undefined && (isNaN(n) || n < 0))) {
      return res.redirect(`/admin/users/${id}?error=invalid_diamonds`);
    }
    try {
      await adminService.updateDiamonds(id, green, purple, rainbow, req.session.adminId!);
    } catch (err) {
      console.error("[admin] update_diamonds failed:", { userId: id, err });
      return res.redirect(`/admin/users/${id}?error=update_failed`);
    }
    res.redirect(`/admin/users/${id}`);
  }

  async reports(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
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
    const reportId = req.params.id as string;
    const { status, ban_user } = req.body;
    await adminService.updateReportStatus(reportId, status);
    if (ban_user === "1") {
      const detail = await adminService.getReportDetail(reportId);
      if (detail?.reported) {
        await adminService.banUser(detail.reported.id, `Banned via report #${reportId}`);
      }
    }
    res.redirect(`/admin/reports/${reportId}`);
  }

  async matches(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const active = req.query.active as string;
    const { matches, total } = await adminService.getMatches(page, 20, active);
    const totalPages = Math.ceil(total / 20);
    res.render("matches", { matches, page, totalPages, total, active: active || "all", session: req.session, csrfToken: req.session.csrfToken });
  }

  async matchDetail(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 50;
    const result = await adminService.getMatchDetail(req.params.id as string, page, limit);
    if (!result) return res.status(404).render("error", { message: "Match not found", session: req.session });
    const totalPages = Math.ceil(result.total / limit);
    res.render("match-detail", { ...result, page, totalPages, session: req.session, csrfToken: req.session.csrfToken });
  }

  async removeAllMatches(req: Request, res: Response) {
    try {
      const count = await adminService.removeAllMatches();
      console.log(`[Admin] Removed all matches: ${count} matches deleted`);
    } catch (err: any) {
      console.error(`[Admin] Remove all matches failed:`, err.message);
    }
    res.redirect("/admin/matches");
  }

  async transactions(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
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

  // ── Send notification to specific user ──────────────────────────
  async sendNotification(req: Request, res: Response) {
    const userId = req.params.id as string;
    const { push_title, push_body, image_url, action_url, action_label } = req.body;

    if (!push_title || !push_body) {
      return res.redirect(`/admin/users/${userId}?notif_error=Title and body are required`);
    }

    try {
      const sent = await NotificationService.sendPush(
        userId,
        'campaign',
        { body: push_body },
        undefined,
        {
          title: push_title,
          imageUrl: image_url || undefined,
          actionUrl: action_url || undefined,
          actionLabel: action_label || undefined,
        },
      );

      const status = sent ? 'sent' : 'saved_no_push';
      res.redirect(`/admin/users/${userId}?notif_success=${status}`);
    } catch (err: any) {
      console.error(`[Admin] Send notification to ${userId} failed:`, err.message);
      res.redirect(`/admin/users/${userId}?notif_error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── App Config management ───────────────────────────────────────
  async appConfig(req: Request, res: Response) {
    try {
      const { data } = await supabase.from("app_config").select("*").limit(1).single();
      res.render("app-config", { config: data, success: req.query.success, error: req.query.error, session: req.session, csrfToken: req.session.csrfToken });
    } catch (err: any) {
      console.error("[Admin] app-config load failed:", err?.message ?? err);
      res.status(500).render("error", { message: "Failed to load app config", session: req.session });
    }
  }

  async updateAppConfig(req: Request, res: Response) {
    const {
      min_version_ios, min_version_android,
      latest_version_ios, latest_version_android,
      store_url_ios, store_url_android,
      is_maintenance, maintenance_message_tr, maintenance_message_en,
      is_force_update_enabled,
      seed_reply_enabled, seed_reply_fast_mode,
      photo_moderation_enabled,
      discover_dormant_days,
      mutual_match_enabled, mutual_match_field,
    } = req.body;

    const versionFields: Record<string, string> = { min_version_ios, min_version_android, latest_version_ios, latest_version_android };
    for (const [field, value] of Object.entries(versionFields)) {
      if (!/^\d+\.\d+\.\d+$/.test((value ?? "").trim())) {
        return res.redirect("/admin/app-config?error=" + encodeURIComponent(`Invalid version for ${field}: use x.y.z format`));
      }
    }

    // Discover uyuyan-aday esigi (migration 074). Form alani yalniz kolon varken render edilir;
    // alan gelmediyse dokunulmaz (074 oncesi kayit, olmayan kolona yazmaya calisip patlamasin).
    let dormantDays: number | undefined;
    if (discover_dormant_days !== undefined) {
      const raw = String(discover_dormant_days).trim();
      dormantDays = Number(raw);
      if (!/^\d{1,3}$/.test(raw) || dormantDays > 365) {
        return res.redirect("/admin/app-config?error=" + encodeURIComponent("discover_dormant_days: 0-365 arasi tam sayi olmali"));
      }
    }

    try {
      await appConfigService.updateConfig({
        // Karşılıklı eşleşme kill-switch (migration 075). Form alanı yalnız kolon varken render
        // edilir (gizli `mutual_match_field` işareti); işaret yoksa dokunulmaz.
        ...(mutual_match_field !== undefined ? { mutual_match_enabled: mutual_match_enabled === "on" } : {}),
        ...(dormantDays !== undefined ? { discover_dormant_days: dormantDays } : {}),
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
        // Seed AI kill-switches (migration 059) — app-config.ejs'de checkbox olarak render edilir.
        seed_reply_enabled: seed_reply_enabled === "on",
        seed_reply_fast_mode: seed_reply_fast_mode === "on",
        // Fotograf moderasyonu kill-switch (migration 064).
        photo_moderation_enabled: photo_moderation_enabled === "on",
      });

      res.redirect("/admin/app-config?success=1");
    } catch (err: any) {
      console.error("[Admin] app-config update failed:", err?.message ?? err);
      res.redirect("/admin/app-config?error=" + encodeURIComponent(err?.message || "Update failed"));
    }
  }

  async diamondEconomy(req: Request, res: Response) {
    const stats = await adminService.getDiamondEconomyStats();
    res.render("diamond-economy", { stats, session: req.session });
  }

  async deleteAdminAction(req: Request, res: Response) {
    if ((req.params.id as string) === req.session.adminId) {
      return res.redirect("/admin/admins");
    }
    await adminService.deleteAdmin(req.params.id as string);
    res.redirect("/admin/admins");
  }
  async questions(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const search = req.query.search as string;
    const category = req.query.category as string;
    const userId = req.query.userId as string;
    const { questions, total } = await adminService.getQuestions(page, 30, search, category, userId);
    const totalPages = Math.ceil(total / 30);
    res.render("questions", {
      questions, page, totalPages, total,
      search: search || "",
      category: category || "all",
      userId: userId || "",
      session: req.session,
      csrfToken: req.session.csrfToken,
    });
  }

  async questionDetail(req: Request, res: Response) {
    const result = await adminService.getQuestionDetail(req.params.id as string);
    if (!result) return res.status(404).render("error", { message: "Question not found", session: req.session });
    res.render("question-detail", { ...result, session: req.session, csrfToken: req.session.csrfToken });
  }

  async questionAction(req: Request, res: Response) {
    const id = req.params.id as string;
    const { action } = req.body;
    if (action === "delete") {
      await adminService.deleteQuestion(id);
      return res.redirect("/admin/questions?deleted=1");
    }
    res.redirect(`/admin/questions/${id}`);
  }

  // ── Economy Config management ──────────────────────────────────
  async economyConfig(req: Request, res: Response) {
    try {
      const { version, config } = await economyConfigService.getActiveConfig();
      res.render("economy-config", {
        config,
        version,
        boundaries: ECONOMY_BOUNDARIES,
        success: req.query.success,
        error: req.query.error,
        session: req.session,
        csrfToken: req.session.csrfToken,
      });
    } catch (err: any) {
      res.render("economy-config", {
        config: null,
        version: 0,
        boundaries: ECONOMY_BOUNDARIES,
        success: null,
        error: err.message,
        session: req.session,
        csrfToken: req.session.csrfToken,
      });
    }
  }

  async updateEconomyConfig(req: Request, res: Response) {
    try {
      const configJson = JSON.parse(req.body.config_json);
      const reason = (req.body.change_reason || "").trim();
      if (!reason) {
        return res.redirect("/admin/economy-config?error=" + encodeURIComponent("Change reason is required"));
      }
      const parsed = economyConfigSchema.parse(configJson);
      await economyConfigService.createVersion(parsed, req.session.adminId!, reason);
      res.redirect("/admin/economy-config?success=1");
    } catch (err: any) {
      const message = err instanceof SyntaxError ? "Invalid JSON format" : err.message;
      res.redirect("/admin/economy-config?error=" + encodeURIComponent(message));
    }
  }

  async economyConfigHistory(req: Request, res: Response) {
    try {
      const history = await economyConfigService.getHistory(50);
      res.render("economy-config-history", { history, session: req.session });
    } catch (err: any) {
      res.render("economy-config-history", { history: [], session: req.session });
    }
  }

  async economyConfigCompare(req: Request, res: Response) {
    try {
      const v1 = parseInt(req.query.v1 as string);
      const v2 = parseInt(req.query.v2 as string);
      if (isNaN(v1) || isNaN(v2)) {
        return res.render("economy-config-compare", { diff: null, v1Data: null, v2Data: null, error: "Invalid version numbers", session: req.session });
      }
      const v1Data = await economyConfigService.getVersion(v1);
      const v2Data = await economyConfigService.getVersion(v2);
      if (!v1Data || !v2Data) {
        return res.render("economy-config-compare", { diff: null, v1Data: null, v2Data: null, error: "Version not found", session: req.session });
      }
      const diff = economyConfigService.compareVersions(v1Data, v2Data);
      res.render("economy-config-compare", { diff, v1Data, v2Data, error: null, session: req.session });
    } catch (err: any) {
      res.render("economy-config-compare", { diff: null, v1Data: null, v2Data: null, error: err.message, session: req.session });
    }
  }

  async updateUserGenderPref(req: Request, res: Response) {
    const id = req.params.id as string;
    try {
      const gender_pref: string = String(req.body.gender_pref ?? "");

      if (!["MAN", "WOMAN", "BOTH"].includes(gender_pref)) {
        return res.redirect(`/admin/users/${id}?error=${encodeURIComponent("Invalid gender_pref value")}`);
      }

      await adminService.updateGenderPref(id, gender_pref as "MAN" | "WOMAN" | "BOTH", req.session.adminEmail!);
      res.redirect(`/admin/users/${id}?success=${encodeURIComponent("Gender preference updated")}`);
    } catch (err: any) {
      res.redirect(`/admin/users/${id}?error=${encodeURIComponent(err.message)}`);
    }
  }

  async updateUserGender(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    if (!isUuid(id)) {
      // Geçersiz id URL'ye yansıtılmaz.
      return res.redirect(`/admin/users?error=${encodeURIComponent("Invalid user id")}`);
    }
    try {
      const gender = String(req.body.gender ?? "");
      if (!["MAN", "WOMAN"].includes(gender)) {
        return res.redirect(`/admin/users/${id}?error=${encodeURIComponent("Invalid gender value")}`);
      }
      await adminService.updateGender(id, gender as "MAN" | "WOMAN", req.session.adminEmail!);
      res.redirect(`/admin/users/${id}?success=${encodeURIComponent("Gender updated")}`);
    } catch (err: any) {
      res.redirect(`/admin/users/${id}?error=${encodeURIComponent(err.message)}`);
    }
  }

  // ── Ticket management ──────────────────────────────────────────
  async tickets(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const status = req.query.status as string | undefined;
      const { tickets, total } = await adminService.getTickets(page, 20, status);
      const totalPages = Math.ceil(total / 20);
      res.render("tickets", { tickets, page, totalPages, total, status: status || "all", session: req.session });
    } catch (err) {
      res.status(500).send("Error loading tickets");
    }
  }

  async ticketDetail(req: Request, res: Response) {
    try {
      const ticket = await adminService.getTicketDetail(req.params.id as string);
      res.render("ticket-detail", { ticket, session: req.session, csrfToken: req.session.csrfToken });
    } catch (err) {
      res.status(404).send("Ticket not found");
    }
  }

  async ticketReply(req: Request, res: Response) {
    try {
      const { reply } = req.body;
      const ticket = await adminService.replyToTicket(req.params.id as string, reply);

      if (ticket.users?.email) {
        await emailService.sendTicketReply(ticket.users.email, ticket.subject, reply, ticket.id);
      }

      res.redirect(`/admin/tickets/${req.params.id}`);
    } catch (err) {
      res.status(500).send("Error replying to ticket");
    }
  }

  // ── Blocks management ──────────────────────────────────────────
  async blocks(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const { blocks, total } = await adminService.getBlocks(page, 20);
      const totalPages = Math.ceil(total / 20);
      res.render("blocks", { blocks, page, totalPages, total, session: req.session });
    } catch (err) {
      res.status(500).send("Error loading blocks");
    }
  }

  // ── Test Push — JSON API for quick FCM debugging ───────────────
  async testPush(req: Request, res: Response) {
    const userId = req.params.id as string;

    try {
      // Fetch user's token info
      const { data: user } = await supabase
        .from('users')
        .select('id, email, name, push_token, locale')
        .eq('id', userId)
        .single();

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const tokenInfo = {
        hasToken: !!user.push_token,
        tokenLength: user.push_token?.length ?? 0,
        tokenPrefix: user.push_token?.substring(0, 20) ?? null,
        locale: user.locale,
      };

      // Try sending a test push
      const sent = await NotificationService.sendPush(
        userId,
        'campaign',
        { body: 'Bu bir test bildirimidir / This is a test notification' },
        undefined,
        {
          title: 'Qulo Test Push',
          actionUrl: '/matches',
        },
      );

      res.json({
        success: sent,
        user: { id: user.id, email: user.email, name: user.name },
        token: tokenInfo,
        message: sent
          ? 'Push sent successfully — check device'
          : 'Push failed — check server logs for [NotificationService] errors',
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }

  // ── Push notification templates (dynamic overrides) ─────────────
  async pushMessagesList(req: Request, res: Response) {
    const parsedQuery = pushTemplateQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.redirect("/admin/push-messages?locale=tr");
    }
    const locale = parsedQuery.data.locale as SupportedLocale;
    const rows = await pushTemplateAdminService.list(locale);
    res.render("push-messages-list", { rows, locale, locales: SUPPORTED_LOCALES, session: req.session, csrfToken: req.session.csrfToken });
  }

  async pushMessageEdit(req: Request, res: Response) {
    const parsedParams = pushTemplateParamsSchema.safeParse(req.params);
    const parsedQuery = pushTemplateQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.redirect("/admin/push-messages?locale=tr");
    }
    const item = await pushTemplateAdminService.getOne(
      parsedParams.data.type as PushType,
      parsedQuery.data.locale as SupportedLocale,
    );
    res.render("push-messages-edit", { item, session: req.session, csrfToken: req.session.csrfToken });
  }

  async pushMessageApiGet(req: Request, res: Response) {
    const parsedParams = pushTemplateParamsSchema.safeParse(req.params);
    const parsedQuery = pushTemplateQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const item = await pushTemplateAdminService.getOne(
      parsedParams.data.type as PushType,
      parsedQuery.data.locale as SupportedLocale,
    );
    res.json(item);
  }

  async pushMessageApiUpsert(req: Request, res: Response) {
    const parsedParams = pushTemplateParamsSchema.safeParse(req.params);
    const parsedQuery = pushTemplateQuerySchema.safeParse(req.query);
    const parsedBody = pushTemplateBodySchema.safeParse(req.body);
    if (!parsedParams.success || !parsedQuery.success || !parsedBody.success) {
      return res.status(400).json({
        error: "invalid_request",
        details: parsedBody.success ? null : parsedBody.error.issues,
      });
    }
    const actor = req.session.adminEmail;
    if (!actor) return res.status(401).json({ error: "unauthenticated" });
    try {
      const row = await pushTemplateAdminService.upsert(
        parsedParams.data.type as PushType,
        parsedQuery.data.locale as SupportedLocale,
        parsedBody.data,
        actor,
      );
      res.json(row);
    } catch (err: any) {
      console.error("[Admin] push-messages upsert failed:", err?.message ?? err);
      res.status(500).json({ error: "server_error" });
    }
  }

  async pushMessageApiRemove(req: Request, res: Response) {
    const parsedParams = pushTemplateParamsSchema.safeParse(req.params);
    const parsedQuery = pushTemplateQuerySchema.safeParse(req.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      await pushTemplateAdminService.remove(
        parsedParams.data.type as PushType,
        parsedQuery.data.locale as SupportedLocale,
      );
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[Admin] push-messages remove failed:", err?.message ?? err);
      res.status(500).json({ error: "server_error" });
    }
  }
}

export const adminController = new AdminController();
