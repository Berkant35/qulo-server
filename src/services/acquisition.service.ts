import { supabase } from "../config/supabase.js";
import { pickLabel } from "../utils/locales.js";

export class AcquisitionService {
  async getChannels(userId: string, overrideLocale?: string) {
    let resolvedLocale = overrideLocale;
    if (!resolvedLocale) {
      const { data: userRow } = await supabase
        .from("users")
        .select("locale")
        .eq("id", userId)
        .maybeSingle();
      resolvedLocale = (userRow?.locale as string | null | undefined) ?? "en";
    }

    const { data, error } = await supabase
      .from("acquisition_channels")
      .select("id, key, label, emoji, icon_url, is_freeform")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((c) => ({
      id: c.id,
      key: c.key,
      label: pickLabel(c.label as Record<string, string>, resolvedLocale!),
      emoji: c.emoji,
      icon_url: c.icon_url,
      is_freeform: c.is_freeform,
    }));
  }

  async submitAnswer(
    userId: string,
    input: { channelId?: string; skipped?: boolean; freeformText?: string },
  ): Promise<{ answered: boolean }> {
    // Idempotent: zaten cevaplamışsa sessizce kabul et
    const { data: existing } = await supabase
      .from("user_acquisition")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return { answered: true };

    let channelKey: string | null = null;
    let isFreeform = false;
    if (input.channelId) {
      const { data: ch } = await supabase
        .from("acquisition_channels")
        .select("key, is_freeform")
        .eq("id", input.channelId)
        .maybeSingle();
      channelKey = ch?.key ?? null;
      isFreeform = ch?.is_freeform ?? false;
    }

    const { error: insertErr } = await supabase.from("user_acquisition").insert({
      user_id: userId,
      channel_id: input.channelId ?? null,
      channel_key: channelKey,
      freeform_text: isFreeform ? (input.freeformText ?? null) : null,
      skipped: input.skipped ?? false,
    });
    // UNIQUE(user_id) yarışında ikinci insert hata verir → idempotent kabul (23505: unique_violation)
    if (insertErr && insertErr.code !== "23505") throw insertErr;

    const { error: flagErr } = await supabase
      .from("users")
      .update({ acquisition_answered: true })
      .eq("id", userId);
    if (flagErr) console.error("[acquisition] acquisition_answered flag update failed:", flagErr.message);

    return { answered: true };
  }
}

export const acquisitionService = new AcquisitionService();
