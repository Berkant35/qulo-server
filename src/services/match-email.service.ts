import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ejs from "ejs";
import { supabase } from "../config/supabase.js";
import { resolveLocale } from "../utils/locales.js";
import { sendEmail } from "../utils/gmail.js";
import { emailUnsubscribeTokenService } from "./email-unsubscribe-token.service.js";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface OwnerRow {
  id: string;
  email: string;
  locale: string | null;
  last_active_at: string | null;
  email_notifications_enabled: boolean;
  is_deleted: boolean;
}

interface MatchNewTpl {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  cta: string;
  unsubscribe_label: string;
}

const emailLocales: Record<string, { match_new: MatchNewTpl }> = {
  tr: require("../locales/emails/tr.json"),
  en: require("../locales/emails/en.json"),
  de: require("../locales/emails/de.json"),
  fr: require("../locales/emails/fr.json"),
  es: require("../locales/emails/es.json"),
  ar: require("../locales/emails/ar.json"),
  ru: require("../locales/emails/ru.json"),
  pt: require("../locales/emails/pt.json"),
  it: require("../locales/emails/it.json"),
  ja: require("../locales/emails/ja.json"),
  ko: require("../locales/emails/ko.json"),
  zh: require("../locales/emails/zh.json"),
  nl: require("../locales/emails/nl.json"),
  pl: require("../locales/emails/pl.json"),
  sv: require("../locales/emails/sv.json"),
  hi: require("../locales/emails/hi.json"),
};

class MatchEmailService {
  async sendMatchEmail(ownerId: string): Promise<void> {
    try {
      const { data: owner } = await supabase
        .from("users")
        .select("id, email, locale, last_active_at, email_notifications_enabled, is_deleted")
        .eq("id", ownerId)
        .single();
      if (!owner) return;
      const o = owner as OwnerRow;

      // 0) Soft-deleted user — never email
      if (o.is_deleted) return;

      // 1) Opt-out kontrolü
      if (!o.email_notifications_enabled) return;

      // 2) Inactive threshold (NULL → inactive kabul)
      if (o.last_active_at) {
        const inactiveMs = Date.now() - new Date(o.last_active_at).getTime();
        if (inactiveMs < INACTIVE_THRESHOLD_MS) return;
      }

      // 3) Locale + content (unknown locale → 'en' fallback via resolveLocale)
      const locale = resolveLocale(o.locale);
      const tpl = emailLocales[locale]?.match_new ?? emailLocales.en.match_new;

      // 4) Unsubscribe token (idempotent per match notification — fresh token each send)
      const token = await emailUnsubscribeTokenService.create(o.id, "match_new");

      // 5) URLs — CTA → public web site, unsubscribe → API
      const ctaUrl = env.WEB_URL;
      const apiBaseUrl = process.env.API_BASE_URL ?? "https://qulo-server-production.up.railway.app";

      // 6) Render
      const html = await ejs.renderFile(
        path.join(__dirname, "../views/emails/match-new.ejs"),
        {
          locale,
          match_new: tpl,
          ctaUrl,
          unsubscribeUrl: `${apiBaseUrl}/unsubscribe?token=${token}`,
        },
      );

      // 7) Send (fire-and-forget at caller level; swallow send errors here so caller is never affected)
      try {
        await sendEmail({
          to: o.email,
          subject: tpl.subject,
          html,
          text: `${tpl.headline}\n\n${tpl.body}\n\n${tpl.cta}: ${ctaUrl}`,
        });
        console.log("[match-email] sent", { ownerId, locale });
      } catch (err) {
        console.error("[match-email] send failed", { ownerId, err });
      }
    } catch (err) {
      console.error("[match-email] sendMatchEmail unexpected error", { ownerId, err });
    }
  }
}

export const matchEmailService = new MatchEmailService();
