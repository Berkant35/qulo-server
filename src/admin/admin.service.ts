import { supabase } from "../config/supabase.js";
import { hashPassword, comparePassword, normalizeEmail } from "../utils/hash.js";
import { sanitizeIlike } from "../utils/validation.js";

class AdminService {
  async findByEmail(email: string) {
    const { data } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", email)
      .single();
    return data;
  }

  async validateLogin(email: string, password: string) {
    const admin = await this.findByEmail(normalizeEmail(email));
    if (!admin) return null;
    const valid = await comparePassword(password, admin.password_hash);
    if (!valid) return null;
    await supabase
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", admin.id);
    return admin;
  }

  async seedAdmin(email: string, password: string) {
    const existing = await this.findByEmail(email);
    if (existing) {
      console.log(`[admin] Seed admin already exists: ${email}`);
      return;
    }
    const password_hash = await hashPassword(password);
    const { error } = await supabase.from("admin_users").insert({
      email,
      password_hash,
      role: "SUPER_ADMIN",
    });
    if (error) {
      console.error(`[admin] Seed admin failed:`, error.message);
      return;
    }
    console.log(`[admin] Seed admin created: ${email}`);
  }

  async getDashboardStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: totalUsers },
      { count: activeUsers },
      { count: todayRegistrations },
      { count: totalMatches },
      { count: pendingReports },
    ] = await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }).eq("is_deleted", false),
      supabase.from("users").select("*", { count: "exact", head: true }).eq("is_deleted", false).gte("last_seen_at", sevenDaysAgo),
      supabase.from("users").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      supabase.from("matches").select("*", { count: "exact", head: true }),
      supabase.from("reports").select("*", { count: "exact", head: true }).eq("status", "PENDING"),
    ]);

    const { data: greenData } = await supabase
      .from("diamond_transactions")
      .select("amount")
      .eq("type", "GREEN")
      .lt("amount", 0);

    const { data: purpleData } = await supabase
      .from("diamond_transactions")
      .select("amount")
      .eq("type", "PURPLE")
      .lt("amount", 0);

    const greenCirculation = (greenData ?? []).reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
    const purpleCirculation = (purpleData ?? []).reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);

    return {
      totalUsers: totalUsers ?? 0,
      activeUsers: activeUsers ?? 0,
      todayRegistrations: todayRegistrations ?? 0,
      totalMatches: totalMatches ?? 0,
      pendingReports: pendingReports ?? 0,
      greenDiamondCirculation: greenCirculation,
      purpleDiamondCirculation: purpleCirculation,
    };
  }

  async getUsers(page: number, limit: number, search?: string, gender?: string) {
    let query = supabase
      .from("users")
      .select("id, email, name, surname, age, gender, city, green_diamonds, purple_diamonds, is_online, is_deleted, created_at, last_seen_at, photos", { count: "exact" })
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      const s = sanitizeIlike(search);
      query = query.or(`email.ilike.%${s}%,name.ilike.%${s}%,surname.ilike.%${s}%`);
    }
    if (gender && gender !== "all") {
      query = query.eq("gender", gender);
    }

    const { data, count } = await query;
    return { users: data ?? [], total: count ?? 0 };
  }

  async getUserDetail(userId: string) {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    const { data: details } = await supabase
      .from("user_details")
      .select("*")
      .eq("user_id", userId)
      .single();

    const { data: questions } = await supabase
      .from("questions")
      .select("*")
      .eq("user_id", userId)
      .order("order_num");

    return { user, details, questions: questions ?? [] };
  }

  async banUser(userId: string) {
    await supabase.from("users").update({ is_deleted: true }).eq("id", userId);
  }

  async unbanUser(userId: string) {
    await supabase.from("users").update({ is_deleted: false }).eq("id", userId);
  }

  async deleteUser(userId: string) {
    await supabase.from("users").delete().eq("id", userId);
  }

  async updateDiamonds(userId: string, green: number, purple: number) {
    await supabase
      .from("users")
      .update({ green_diamonds: green, purple_diamonds: purple })
      .eq("id", userId);
  }

  async setSubscription(userId: string, plan: string, durationDays: number) {
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("users")
      .update({ subscription_plan: plan, subscription_expires_at: expiresAt })
      .eq("id", userId);
    await supabase.from("user_subscriptions").insert({
      user_id: userId,
      plan,
      status: "active",
      rc_customer_id: `admin_grant`,
      store_transaction_id: `admin_${Date.now()}`,
      started_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  }

  async cancelSubscription(userId: string) {
    await supabase
      .from("users")
      .update({ subscription_plan: null, subscription_expires_at: null })
      .eq("id", userId);
    await supabase
      .from("user_subscriptions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");
  }

  async getReports(page: number, limit: number, status?: string) {
    let query = supabase
      .from("reports")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, count } = await query;
    return { reports: data ?? [], total: count ?? 0 };
  }

  async getReportDetail(reportId: string) {
    const { data: report } = await supabase
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (!report) return null;

    const [{ data: reporter }, { data: reported }] = await Promise.all([
      supabase.from("users").select("id, email, name, surname, photos").eq("id", report.reporter_id).single(),
      supabase.from("users").select("id, email, name, surname, photos, is_deleted").eq("id", report.reported_id).single(),
    ]);

    return { report, reporter, reported };
  }

  async updateReportStatus(reportId: string, status: string) {
    await supabase.from("reports").update({ status }).eq("id", reportId);
  }

  async getMatches(page: number, limit: number, active?: string) {
    let query = supabase
      .from("matches")
      .select("*", { count: "exact" })
      .order("matched_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (active === "true") query = query.eq("is_active", true);
    if (active === "false") query = query.eq("is_active", false);

    const { data, count } = await query;

    if (data && data.length > 0) {
      const userIds = [...new Set(data.flatMap((m: any) => [m.user1_id, m.user2_id]))];
      const { data: users } = await supabase
        .from("users")
        .select("id, name, surname, email")
        .in("id", userIds);

      const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));
      const enriched = data.map((m: any) => ({
        ...m,
        user1: userMap.get(m.user1_id),
        user2: userMap.get(m.user2_id),
      }));
      return { matches: enriched, total: count ?? 0 };
    }

    return { matches: data ?? [], total: count ?? 0 };
  }

  async getTransactions(page: number, limit: number, type?: string, userId?: string) {
    let query = supabase
      .from("diamond_transactions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (type && type !== "all") query = query.eq("type", type);
    if (userId) query = query.eq("user_id", userId);

    const { data, count } = await query;
    return { transactions: data ?? [], total: count ?? 0 };
  }

  async getQuizStats() {
    const [
      { count: totalSessions },
      { count: completedSessions },
      { count: failedSessions },
    ] = await Promise.all([
      supabase.from("quiz_sessions").select("*", { count: "exact", head: true }),
      supabase.from("quiz_sessions").select("*", { count: "exact", head: true }).eq("status", "COMPLETED"),
      supabase.from("quiz_sessions").select("*", { count: "exact", head: true }).eq("status", "FAILED"),
    ]);

    const { data: powerUsage } = await supabase
      .from("quiz_answers")
      .select("power_used")
      .not("power_used", "is", null);

    const powerCounts: Record<string, number> = {};
    (powerUsage ?? []).forEach((a: any) => {
      powerCounts[a.power_used] = (powerCounts[a.power_used] || 0) + 1;
    });

    return {
      totalSessions: totalSessions ?? 0,
      completedSessions: completedSessions ?? 0,
      failedSessions: failedSessions ?? 0,
      successRate: totalSessions ? Math.round(((completedSessions ?? 0) / totalSessions) * 100) : 0,
      powerUsage: powerCounts,
    };
  }

  async getAdmins() {
    const { data } = await supabase
      .from("admin_users")
      .select("id, email, role, created_at, last_login_at")
      .order("created_at");
    return data ?? [];
  }

  async createAdmin(email: string, password: string, role: string) {
    const existing = await this.findByEmail(email);
    if (existing) throw new Error("Admin already exists");
    const password_hash = await hashPassword(password);
    await supabase.from("admin_users").insert({ email, password_hash, role });
  }

  async deleteAdmin(adminId: string) {
    await supabase.from("admin_users").delete().eq("id", adminId);
  }
}

export const adminService = new AdminService();
