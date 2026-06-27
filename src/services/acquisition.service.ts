import { supabase } from "../config/supabase.js";
import { pickLabel } from "../utils/locales.js";

export class AcquisitionService {
  async getChannels(locale: string) {
    const { data, error } = await supabase
      .from("acquisition_channels")
      .select("id, key, label, emoji, is_freeform")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((c) => ({
      id: c.id,
      key: c.key,
      label: pickLabel(c.label as Record<string, string>, locale),
      emoji: c.emoji,
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
    // UNIQUE(user_id) yarışında ikinci insert hata verir → idempotent kabul
    if (insertErr && !insertErr.message.includes("duplicate")) throw insertErr;

    await supabase
      .from("users")
      .update({ acquisition_answered: true })
      .eq("id", userId);

    return { answered: true };
  }
}

export const acquisitionService = new AcquisitionService();
