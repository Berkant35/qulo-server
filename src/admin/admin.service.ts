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

  async resetSwipes(userId: string) {
    const { count } = await supabase
      .from("swipes")
      .select("*", { count: "exact", head: true })
      .eq("swiper_id", userId);

    const { error } = await supabase
      .from("swipes")
      .delete()
      .eq("swiper_id", userId);

    if (error) {
      console.error("[admin] Reset swipes error:", error.message);
      throw new Error("Failed to reset swipes");
    }

    // Reset daily swipe counter as well
    await supabase
      .from("users")
      .update({ daily_swipes_used: 0 })
      .eq("id", userId);

    return count ?? 0;
  }

  async getSwipeCount(userId: string) {
    const { count } = await supabase
      .from("swipes")
      .select("*", { count: "exact", head: true })
      .eq("swiper_id", userId);
    return count ?? 0;
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

  async getDiamondEconomyStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Total supply (sum of all users' diamonds)
    const { data: supplyData } = await supabase
      .from("users")
      .select("green_diamonds, purple_diamonds")
      .eq("is_deleted", false);

    const totalGreenSupply = (supplyData ?? []).reduce((s: number, u: any) => s + (u.green_diamonds || 0), 0);
    const totalPurpleSupply = (supplyData ?? []).reduce((s: number, u: any) => s + (u.purple_diamonds || 0), 0);

    // Spending by reason (all time)
    const { data: greenSpending } = await supabase
      .from("diamond_transactions")
      .select("reason, amount")
      .eq("type", "GREEN")
      .lt("amount", 0);

    const { data: purpleSpending } = await supabase
      .from("diamond_transactions")
      .select("reason, amount")
      .eq("type", "PURPLE")
      .lt("amount", 0);

    const greenByReason: Record<string, number> = {};
    (greenSpending ?? []).forEach((t: any) => {
      const r = t.reason || 'unknown';
      greenByReason[r] = (greenByReason[r] || 0) + Math.abs(t.amount);
    });

    const purpleByReason: Record<string, number> = {};
    (purpleSpending ?? []).forEach((t: any) => {
      const r = t.reason || 'unknown';
      purpleByReason[r] = (purpleByReason[r] || 0) + Math.abs(t.amount);
    });

    // Earnings by reason (all time)
    const { data: greenEarnings } = await supabase
      .from("diamond_transactions")
      .select("reason, amount")
      .eq("type", "GREEN")
      .gt("amount", 0);

    const { data: purpleEarnings } = await supabase
      .from("diamond_transactions")
      .select("reason, amount")
      .eq("type", "PURPLE")
      .gt("amount", 0);

    const greenEarnByReason: Record<string, number> = {};
    (greenEarnings ?? []).forEach((t: any) => {
      const r = t.reason || 'unknown';
      greenEarnByReason[r] = (greenEarnByReason[r] || 0) + t.amount;
    });

    const purpleEarnByReason: Record<string, number> = {};
    (purpleEarnings ?? []).forEach((t: any) => {
      const r = t.reason || 'unknown';
      purpleEarnByReason[r] = (purpleEarnByReason[r] || 0) + t.amount;
    });

    // Transaction volumes (today, 7d, 30d)
    const [
      { count: txToday },
      { count: tx7d },
      { count: tx30d },
      { count: txTotal },
    ] = await Promise.all([
      supabase.from("diamond_transactions").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
      supabase.from("diamond_transactions").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      supabase.from("diamond_transactions").select("*", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
      supabase.from("diamond_transactions").select("*", { count: "exact", head: true }),
    ]);

    // Power purchase stats
    const { data: powerPurchases } = await supabase
      .from("power_purchase_transactions")
      .select("power_name, quantity, diamond_type, total_cost");

    const powerStats: Record<string, { totalBought: number, greenSpent: number, purpleSpent: number }> = {};
    (powerPurchases ?? []).forEach((p: any) => {
      if (!powerStats[p.power_name]) {
        powerStats[p.power_name] = { totalBought: 0, greenSpent: 0, purpleSpent: 0 };
      }
      powerStats[p.power_name].totalBought += p.quantity;
      if (p.diamond_type === 'GREEN') {
        powerStats[p.power_name].greenSpent += p.total_cost;
      } else {
        powerStats[p.power_name].purpleSpent += p.total_cost;
      }
    });

    // IAP revenue (purple diamond purchases via RevenueCat)
    const { data: iapData } = await supabase
      .from("iap_transactions")
      .select("product_id, amount, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    // Top spenders
    const { data: topSpenders } = await supabase
      .from("diamond_transactions")
      .select("user_id, amount")
      .lt("amount", 0);

    const spenderMap: Record<string, number> = {};
    (topSpenders ?? []).forEach((t: any) => {
      spenderMap[t.user_id] = (spenderMap[t.user_id] || 0) + Math.abs(t.amount);
    });
    const topSpenderList: any[] = Object.entries(spenderMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, totalSpent]) => ({ userId, totalSpent }));

    // Get names for top spenders
    if (topSpenderList.length > 0) {
      const ids = topSpenderList.map(s => s.userId);
      const { data: users } = await supabase
        .from("users")
        .select("id, name, surname, email")
        .in("id", ids);
      const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));
      topSpenderList.forEach((s: any) => {
        const u = userMap.get(s.userId);
        s.name = u ? `${u.name || ''} ${u.surname || ''}`.trim() || u.email : s.userId.substring(0, 8);
      });
    }

    return {
      totalGreenSupply,
      totalPurpleSupply,
      greenByReason,
      purpleByReason,
      greenEarnByReason,
      purpleEarnByReason,
      txToday: txToday ?? 0,
      tx7d: tx7d ?? 0,
      tx30d: tx30d ?? 0,
      txTotal: txTotal ?? 0,
      powerStats,
      iapTransactions: iapData ?? [],
      topSpenders: topSpenderList,
    };
  }
  async getQuestions(page: number, limit: number, search?: string, category?: string, userId?: string) {
    let query = supabase
      .from("questions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      const s = sanitizeIlike(search);
      query = query.ilike("question_text", `%${s}%`);
    }
    if (category && category !== "all") query = query.eq("category", category);
    if (userId) query = query.eq("user_id", userId);

    const { data, count } = await query;
    const questions = data ?? [];

    // Enrich with user info
    if (questions.length > 0) {
      const userIds = [...new Set(questions.map((q: any) => q.user_id))];
      const { data: users } = await supabase
        .from("users")
        .select("id, name, surname, email")
        .in("id", userIds);
      const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));
      questions.forEach((q: any) => { q.users = userMap.get(q.user_id) || null; });
    }

    return { questions, total: count ?? 0 };
  }

  async getQuestionDetail(questionId: string) {
    const { data: question } = await supabase
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .single();

    if (!question) return null;

    const { data: user } = await supabase
      .from("users")
      .select("id, name, surname, email, photos")
      .eq("id", question.user_id)
      .single();

    return { question, user };
  }

  async deleteQuestion(questionId: string) {
    await supabase.from("questions").delete().eq("id", questionId);
  }
}

export const adminService = new AdminService();
