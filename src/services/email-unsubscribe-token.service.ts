import crypto from "node:crypto";
import { supabase } from "../config/supabase.js";

export interface EmailUnsubscribeTokenRow {
  token: string;
  user_id: string;
  email_type: string;
  used_at: string | null;
}

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
