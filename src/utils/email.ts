import { readFileSync } from "fs";
import { resolveLocale, webLocale } from "./locales.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { sendEmail } from "./gmail.js";
import { maskEmail } from "./pii.js";
import { renderEmailLayout } from "./email-layout.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const localeCache = new Map<string, Record<string, string>>();

function getEmailLocale(locale?: string): Record<string, string> {
  const loc = resolveLocale(locale);
  if (localeCache.has(loc)) return localeCache.get(loc)!;
  try {
    const filePath = join(__dirname, "..", "locales", "emails", `${loc}.json`);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    localeCache.set(loc, data);
    return data;
  } catch {
    if (loc !== "en") {
      // Dosya yoksa her cagrida tekrar readFileSync + exception olmasin: en verisini bu dil icin de cache'le.
      const fallback = getEmailLocale("en");
      localeCache.set(loc, fallback);
      return fallback;
    }
    throw new Error("English email locale file not found");
  }
}

function renderTemplate(
  loc: string,
  strings: Record<string, string>,
  url: string,
  type: "verify" | "reset",
): string {
  return renderEmailLayout({
    locale: loc,
    preheader: strings[`${type}_body`],
    tagline: strings.tagline,
    title: strings[`${type}_title`],
    paragraphs: [strings[`${type}_body`]],
    button: { label: strings[`${type}_button`], url },
    fallback: { label: strings.link_fallback, url },
    footerLines: [strings.footer_ignore],
  });
}

export async function sendVerificationEmail(
  to: string,
  token: string,
  locale?: string,
): Promise<void> {
  const loc = resolveLocale(locale);
  const strings = getEmailLocale(loc);
  const url = `${env.APP_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
  const html = renderTemplate(loc, strings, url, "verify");

  const maskedTo = maskEmail(to);
  console.log(`[email] Sending verification email to ${maskedTo}...`);
  await sendEmail({
    to,
    subject: strings.verify_subject,
    html,
    text: `${strings.verify_title}\n\n${strings.verify_body}\n\n${url}`,
  });
  console.log(`[email] Verification email sent to ${maskedTo}`);
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  locale?: string,
): Promise<void> {
  // Ayni girdi bir kez cozulur: e-posta metni ile link dili ayrisamaz.
  const loc = resolveLocale(locale);
  const strings = getEmailLocale(loc);
  const url = `${env.WEB_URL}/${webLocale(loc)}/reset-password?token=${encodeURIComponent(token)}`;
  const html = renderTemplate(loc, strings, url, "reset");

  const maskedTo = maskEmail(to);
  console.log(`[email] Sending password reset email to ${maskedTo}...`);
  await sendEmail({
    to,
    subject: strings.reset_subject,
    html,
    text: `${strings.reset_title}\n\n${strings.reset_body}\n\n${url}`,
  });
  console.log(`[email] Password reset email sent to ${maskedTo}`);
}
