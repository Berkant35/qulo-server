import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { sendEmail } from "../utils/gmail.js";
import { resolveLocale } from "../utils/locales.js";
import { emailLocales } from "../utils/email-locales.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Kullaniciya gosterilen gerekce; serbest metin degil, sozlukten (18 dil). */
export type BanReasonKey = "sexual_content" | "guidelines";

/** Itiraz baglantisi bu sureden sonra gecersiz (posta kutusu aylar sonra ele gecse bile). */
export const APPEAL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BanAppealRow {
  id: string;
  user_id: string;
  token: string;
  ban_reason: string;
  status: "pending" | "submitted" | "resolved";
  message: string | null;
  submitted_at: string | null;
  created_at: string;
}

interface BannedUserRow {
  id: string;
  email: string | null;
  name: string | null;
  locale: string | null;
  is_deleted: boolean;
  is_test_account: boolean | null;
}

/** Itiraz mesaji: kullanici formu; DB'ye yazilan uzunluk sinirli. */
export const APPEAL_MESSAGE_MAX = 1000;

/**
 * Hesap banlama tek yol: bayraklar + eslesmelerin kapatilmasi + e-posta (itiraz baglantili).
 * Admin paneli ve fotograf moderasyonu ayni fonksiyonu cagirir; e-posta hatasi ban'i geri almaz.
 */
class BanService {
  /**
   * Idempotent: zaten banli kullanicida hicbir sey yapmaz ve false doner (rolling deploy'da iki
   * instance ayni fotografi tarayabilir; admin ayni butona iki kez basabilir — cift e-posta yok).
   */
  async banUser(userId: string, reasonKey: BanReasonKey, reasonText: string): Promise<boolean> {
    // Admin yolunda id req.params'tan dogrulanmadan gelir; asagidaki filtrelere ham girmesin.
    if (!UUID_DESENI.test(userId)) throw new Error("ban: gecersiz userId");
    const { data, error: banError } = await supabase
      .from("users")
      .update({ is_banned: true, banned_at: new Date().toISOString(), ban_reason: reasonText })
      .eq("id", userId)
      .eq("is_banned", false)
      .select("id");
    if (banError) throw new Error(`ban update failed: ${banError.message}`);
    if (!data || data.length === 0) return false;

    await supabase.from("matches").update({ is_active: false }).eq("user1_id", userId);
    await supabase.from("matches").update({ is_active: false }).eq("user2_id", userId);

    try {
      await this.sendBanNotice(userId, reasonKey, reasonText);
    } catch (err) {
      console.error("[ban] notice failed", { userId, err: err instanceof Error ? err.message : err });
    }
    return true;
  }

  async unbanUser(userId: string): Promise<void> {
    const { error } = await supabase
      .from("users")
      .update({ is_banned: false, banned_at: null, ban_reason: null })
      .eq("id", userId);
    if (error) throw new Error(`unban update failed: ${error.message}`);
    await supabase.from("ban_appeals").update({ status: "resolved" }).eq("user_id", userId).neq("status", "resolved");
  }

  /** Ban e-postasi: kullanicinin dilinde, tek kullanimlik itiraz baglantisiyla. */
  private async sendBanNotice(userId: string, reasonKey: BanReasonKey, reasonText: string): Promise<void> {
    const { data } = await supabase
      .from("users")
      .select("id, email, name, locale, is_deleted, is_test_account")
      .eq("id", userId)
      .maybeSingle();
    const user = data as BannedUserRow | null;
    // Test/seed hesaplarinin adresi sahte (@qulo.test) — bounce uretmemek icin e-posta yok.
    if (!user?.email || user.is_deleted || user.is_test_account) return;

    const token = crypto.randomBytes(32).toString("hex");
    const { error } = await supabase
      .from("ban_appeals")
      .insert({ user_id: userId, token, ban_reason: reasonText });
    if (error) throw new Error(`appeal token insert failed: ${error.message}`);

    const locale = resolveLocale(user.locale);
    const tpl = emailLocales[locale]?.ban_notice ?? emailLocales.en.ban_notice;
    const reason = reasonKey === "sexual_content" ? tpl.reason_sexual_content : tpl.reason_guidelines;
    const appealUrl = `${env.API_BASE_URL}/ban-appeal?token=${token}`;
    const html = await ejs.renderFile(
      path.join(__dirname, "../views/emails/ban-notice.ejs"),
      { locale, ban_notice: tpl, reason, appealUrl },
    );
    await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html,
      text: `${tpl.headline}\n\n${tpl.body}\n\n${tpl.reason_label}: ${reason}\n\n${tpl.appeal_intro}\n${appealUrl}`,
    });
    console.log("[ban] notice sent", { userId, locale, reasonKey });
  }

  async findAppeal(token: string): Promise<BanAppealRow | null> {
    const { data, error } = await supabase
      .from("ban_appeals")
      .select("id, user_id, token, ban_reason, status, message, submitted_at, created_at")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as BanAppealRow;
    if (Date.now() - new Date(row.created_at).getTime() > APPEAL_TOKEN_TTL_MS) return null;
    return row;
  }

  /**
   * Itiraz gonderimi: token bir kez kullanilir; admin'e e-posta duser.
   * Donus false = token pending degil (zaten gonderilmis/cozulmus).
   */
  async submitAppeal(token: string, message: string): Promise<boolean> {
    const kirpilmis = message.trim().slice(0, APPEAL_MESSAGE_MAX);
    const { data, error } = await supabase
      .from("ban_appeals")
      .update({ status: "submitted", message: kirpilmis || null, submitted_at: new Date().toISOString() })
      .eq("token", token)
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - APPEAL_TOKEN_TTL_MS).toISOString())
      .select("id, user_id, ban_reason");
    if (error) throw new Error(`appeal submit failed: ${error.message}`);
    const row = (data as Pick<BanAppealRow, "id" | "user_id" | "ban_reason">[] | null)?.[0];
    if (!row) return false;

    try {
      await this.notifyAdmin(row.user_id, row.ban_reason, kirpilmis);
    } catch (err) {
      console.error("[ban] admin appeal notify failed", { appealId: row.id, err: err instanceof Error ? err.message : err });
    }
    return true;
  }

  private async notifyAdmin(userId: string, banReason: string, message: string): Promise<void> {
    const { data } = await supabase
      .from("users")
      .select("email, name, banned_at")
      .eq("id", userId)
      .maybeSingle();
    const to = env.BAN_APPEAL_NOTIFY_EMAIL || env.EMAIL_FROM;
    const adminUrl = `${env.API_BASE_URL}/admin/users/${userId}`;
    const html = await ejs.renderFile(
      path.join(__dirname, "../admin/views/emails/ban-appeal.ejs"),
      { userId, email: data?.email ?? "-", name: data?.name ?? "-", bannedAt: data?.banned_at ?? "-", banReason, message, adminUrl },
    );
    await sendEmail({
      to,
      subject: `[Qulo] Ban itirazı: ${data?.email ?? userId}`,
      html,
      text: `Kullanıcı: ${data?.name ?? "-"} <${data?.email ?? "-"}>\nBan sebebi: ${banReason}\nMesaj: ${message || "(boş)"}\n\n${adminUrl}`,
    });
  }
}

export const banService = new BanService();
