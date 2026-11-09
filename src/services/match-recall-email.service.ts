import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { resolveLocale } from "../utils/locales.js";
import { sendEmail } from "../utils/gmail.js";
import { emailLocales, type MatchNewTpl } from "../utils/email-locales.js";
import { emailUnsubscribeTokenService } from "./email-unsubscribe-token.service.js";
import { isSeedRecipient } from "../utils/seed-recipient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Abonelikten cikma token'inin turu — unsubscribe ucu ture bakmaz, tum eslesme e-postalarini kapatir. */
export const MATCH_RECALL_EMAIL_TYPE = "match_recall";

export type RecallEmailSkip = "user_not_found" | "seed_profile" | "email_opt_out" | "no_email" | "email_unverified" | "email_recent";

/** Gonderime hazir hedef (`prepare` sonucu). */
export interface RecallEmailTarget {
  id: string;
  email: string;
  locale: string | null;
}

interface RecallTargetRow {
  id: string;
  email: string | null;
  locale: string | null;
  email_notifications_enabled: boolean | null;
  email_verified: boolean | null;
  is_deleted: boolean | null;
  is_seed_profile: boolean | null;
}

/**
 * "Seni cozduler" e-posta yedegi (2.0.18 plan madde 6) — push token'i olmayan hedefe. Yalniz bildirim
 * motoru cagirir (engine.ts, `app_config.recall_email_enabled` acikken; varsayilan KAPALI).
 *
 * Iki adim: `prepare` gonderilmeyecek hedefi (tercih kapali, adres yok/dogrulanmamis, son 20 sa e-posta)
 * motorun tur butcesini (max_per_run) ve "in_flight" kaydini harcamadan eler; `deliver` gonderir.
 * Metin push sablonundan gelir (`push.lifecycle_solved_waiting`, 18 dil + backoffice override): ayni
 * kural, ayni cumle. Govde `match-new.ejs` (CTA + abonelikten cikma etiketi `match_new` sozlugunden).
 */
class MatchRecallEmailService {
  async prepare(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ ok: true; target: RecallEmailTarget } | { ok: false; reason: RecallEmailSkip | "lookup_failed" }> {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, locale, email_notifications_enabled, email_verified, is_deleted, is_seed_profile")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("[match-recall-email] hedef okunamadi", { userId, error: error.message });
      return { ok: false, reason: "lookup_failed" };
    }
    const row = data as RecallTargetRow | null;
    if (!row || row.is_deleted) return { ok: false, reason: "user_not_found" };
    // Motor seed'i zaten aday listesinden eler (isEmailFallbackUser); bu ikinci kapi servisi tek basina guvenli kilar.
    if (isSeedRecipient(row)) return { ok: false, reason: "seed_profile" };
    if (!row.email_notifications_enabled) return { ok: false, reason: "email_opt_out" };
    if (!row.email) return { ok: false, reason: "no_email" };
    // Baskasinin adresiyle acilmis hesap karsi tarafin adini o adrese yollatmasin.
    if (row.email_verified !== true) return { ok: false, reason: "email_unverified" };
    if (await emailUnsubscribeTokenService.sentWithinDailyWindow(userId, now)) return { ok: false, reason: "email_recent" };
    return { ok: true, target: { id: row.id, email: row.email, locale: row.locale } };
  }

  /** Gonderir; Gmail yapilandirilmamissa (null) ya da hata verirse false — basari sayilmaz. */
  async deliver(target: RecallEmailTarget, text: { title: string; body: string }): Promise<boolean> {
    try {
      const locale = resolveLocale(target.locale);
      const base = emailLocales[locale]?.match_new ?? emailLocales.en.match_new;
      const tpl: MatchNewTpl = { ...base, subject: text.title, preheader: text.body, headline: text.title, body: text.body };
      const token = await emailUnsubscribeTokenService.create(target.id, MATCH_RECALL_EMAIL_TYPE);
      const ctaUrl = env.WEB_URL;
      const html = await ejs.renderFile(path.join(__dirname, "../views/emails/match-new.ejs"), {
        locale,
        match_new: tpl,
        ctaUrl,
        unsubscribeUrl: `${env.API_BASE_URL}/unsubscribe?token=${token}`,
      });
      const messageId = await sendEmail({
        to: target.email,
        subject: tpl.subject,
        html,
        text: `${tpl.headline}\n\n${tpl.body}\n\n${tpl.cta}: ${ctaUrl}`,
      });
      return messageId != null;
    } catch (err) {
      console.error("[match-recall-email] gonderilemedi", { userId: target.id, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}

export const matchRecallEmailService = new MatchRecallEmailService();
