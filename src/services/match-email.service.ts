import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { supabase } from "../config/supabase.js";
import { resolveLocale } from "../utils/locales.js";
import { sendEmail } from "../utils/gmail.js";
import { emailLocales } from "../utils/email-locales.js";
import { emailUnsubscribeTokenService } from "./email-unsubscribe-token.service.js";
import { env } from "../config/env.js";
import { isSeedRecipient } from "../utils/seed-recipient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface OwnerRow {
  id: string;
  email: string;
  locale: string | null;
  last_active_at: string | null;
  email_notifications_enabled: boolean;
  email_verified: boolean | null;
  is_deleted: boolean;
  is_seed_profile: boolean | null;
}

class MatchEmailService {
  async sendMatchEmail(ownerId: string): Promise<void> {
    try {
      const { data: owner } = await supabase
        .from("users")
        .select("id, email, locale, last_active_at, email_notifications_enabled, email_verified, is_deleted, is_seed_profile")
        .eq("id", ownerId)
        .single();
      if (!owner) return;
      const o = owner as OwnerRow;

      // 0) Soft-deleted user — never email
      if (o.is_deleted) return;

      // 0b) Seed (test) profili — gercek kullanici seed'in sorularini cozunce buraya gelir; adres @qulo.seed
      // (bounce). Seed satiri dogrulanmis + tercih acik basilir, asagidaki kapilar onu elemez.
      if (isSeedRecipient(o)) return;

      // 1) Opt-out kontrolü
      if (!o.email_notifications_enabled) return;

      // 1b) Dogrulanmamis adrese eslesme e-postasi yok: baskasinin adresiyle acilan hesap, karsi tarafin
      // adini o adrese yollatmasin (2.0.18 inceleme). Prod 10-01..11-09: 190 e-postanin 1'i dogrulanmamisa.
      if (o.email_verified !== true) return;

      // 2) Inactive threshold (NULL → inactive kabul)
      if (o.last_active_at) {
        const inactiveMs = Date.now() - new Date(o.last_active_at).getTime();
        if (inactiveMs < INACTIVE_THRESHOLD_MS) return;
      }

      // 2b) Gunluk tavan: son 20 saatte bu kullaniciya herhangi bir e-posta gittiyse atla.
      // Prod 10-01..11-09: 190 eslesme e-postasinin 33'u ayni gun ikinci+ e-postaydi (tek hedefe gunde 4).
      if (await emailUnsubscribeTokenService.sentWithinDailyWindow(o.id)) return;

      // 3) Locale + content (unknown locale → 'en' fallback via resolveLocale)
      const locale = resolveLocale(o.locale);
      const tpl = emailLocales[locale]?.match_new ?? emailLocales.en.match_new;

      // 4) Unsubscribe token (idempotent per match notification — fresh token each send)
      const token = await emailUnsubscribeTokenService.create(o.id, "match_new");

      // 5) URLs — CTA → public web site, unsubscribe → API
      const ctaUrl = env.WEB_URL;
      const apiBaseUrl = env.API_BASE_URL;

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
