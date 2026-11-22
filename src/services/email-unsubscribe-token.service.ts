import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";

export interface EmailUnsubscribeTokenRow {
  token: string;
  user_id: string;
  email_type: string;
  used_at: string | null;
}

/** Kullanici basina e-posta tavani penceresi: bildirim motorunun "gunde tek karar" penceresiyle ayni. */
export const EMAIL_DAILY_WINDOW_MS = 20 * 60 * 60 * 1000;

class EmailUnsubscribeTokenService {
  async create(userId: string, emailType: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    const { error } = await supabase
      .from("email_unsubscribe_tokens")
      .insert({ token, user_id: userId, email_type: emailType });
    if (error) {
      console.error("[unsubscribe-token] create failed", error);
      throw new Error("Failed to create unsubscribe token");
    }
    return token;
  }

  /**
   * Kullaniciya `sinceIso`dan beri e-posta gonderildi mi? Her gonderim (eslesme, "seni cozduler") ONCE
   * bir abonelikten cikma token'i uretir — token tablosu gonderim kaydidir. Gunluk e-posta tavani buradan.
   * Okuma hatasinda `true` (fail-closed): belirsizken e-posta atmamak, fazla atmaktan iyidir.
   */
  async issuedSince(userId: string, sinceIso: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (error) {
      console.error("[unsubscribe-token] issuedSince failed", error.message);
      return true;
    }
    return (count ?? 0) > 0;
  }

  /** Gunluk e-posta tavani: son `EMAIL_DAILY_WINDOW_MS` icinde e-posta gitti mi (fail-closed). */
  async sentWithinDailyWindow(userId: string, now: Date = new Date()): Promise<boolean> {
    return this.issuedSince(userId, new Date(now.getTime() - EMAIL_DAILY_WINDOW_MS).toISOString());
  }

  async findUnused(token: string): Promise<EmailUnsubscribeTokenRow | null> {
    const { data, error } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token, user_id, email_type, used_at")
      .eq("token", token)
      .single();
    if (error || !data) return null;
    return data as EmailUnsubscribeTokenRow;
  }

  async markUsed(token: string): Promise<void> {
    const { error } = await supabase
      .from("email_unsubscribe_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);
    if (error) {
      console.error("[unsubscribe-token] markUsed failed", error);
      throw new Error("Failed to mark unsubscribe token used");
    }
  }
}

export const emailUnsubscribeTokenService = new EmailUnsubscribeTokenService();
