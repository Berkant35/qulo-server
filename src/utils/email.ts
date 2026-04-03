import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { readFileSync } from "fs";
import { join } from "path";
import { env } from "../config/env.js";

if (env.NODE_ENV === "production" && !env.SMTP_HOST) {
  console.warn("[EMAIL] WARNING: SMTP not configured in production — emails disabled");
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn("[email] SMTP not configured. Emails will not be sent.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

// Template cache
let templateCache: string | null = null;

function getTemplate(): string {
  if (templateCache) return templateCache;
  const templatePath = join(__dirname, "..", "templates", "email-base.html");
  templateCache = readFileSync(templatePath, "utf-8");
  return templateCache;
}

// Locale cache
const localeCache = new Map<string, Record<string, string>>();

const SUPPORTED_LOCALES = [
  "tr", "en", "de", "fr", "es", "ar", "ru",
  "pt", "it", "ja", "ko", "zh", "nl", "pl", "sv", "hi",
];

function getEmailLocale(locale?: string): Record<string, string> {
  const loc = SUPPORTED_LOCALES.includes(locale ?? "") ? locale! : "en";
  if (localeCache.has(loc)) return localeCache.get(loc)!;

  try {
    const filePath = join(__dirname, "..", "locales", "emails", `${loc}.json`);
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    localeCache.set(loc, data);
    return data;
  } catch {
    if (loc !== "en") return getEmailLocale("en");
    throw new Error("English email locale file not found");
  }
}

function renderTemplate(
  strings: Record<string, string>,
  url: string,
  type: "verify" | "reset",
): string {
  const template = getTemplate();
  const prefix = type === "verify" ? "verify" : "reset";

  return template
    .replace(/\{\{TAGLINE\}\}/g, strings.tagline)
    .replace(/\{\{TITLE\}\}/g, strings[`${prefix}_title`])
    .replace(/\{\{BODY\}\}/g, strings[`${prefix}_body`])
    .replace(/\{\{BUTTON_TEXT\}\}/g, strings[`${prefix}_button`])
    .replace(/\{\{URL\}\}/g, url)
    .replace(/\{\{LINK_FALLBACK\}\}/g, strings.link_fallback)
    .replace(/\{\{FOOTER_IGNORE\}\}/g, strings.footer_ignore);
}

export async function sendVerificationEmail(
  to: string,
  token: string,
  locale?: string,
): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] Verification email to ${to} skipped (SMTP not configured). Token: ${token}`);
    return;
  }

  const strings = getEmailLocale(locale);
  const url = `${env.APP_URL}/api/v1/auth/verify-email?token=${token}`;
  const html = renderTemplate(strings, url, "verify");

  await t.sendMail({
    from: `"Qulo" <${env.SMTP_FROM}>`,
    to,
    subject: strings.verify_subject,
    html,
    text: `${strings.verify_title}\n\n${strings.verify_body}\n\n${url}`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  locale?: string,
): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] Password reset email to ${to} skipped (SMTP not configured). Token: ${token}`);
    return;
  }

  const strings = getEmailLocale(locale);
  const webLocale = SUPPORTED_LOCALES.includes(locale ?? "") ? locale! : "en";
  const url = `${env.WEB_URL}/${webLocale}/reset-password?token=${token}`;
  const html = renderTemplate(strings, url, "reset");

  await t.sendMail({
    from: `"Qulo" <${env.SMTP_FROM}>`,
    to,
    subject: strings.reset_subject,
    html,
    text: `${strings.reset_title}\n\n${strings.reset_body}\n\n${url}`,
  });
}
