import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";

if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
  console.warn('[EMAIL] WARNING: SMTP not configured in production — email verification disabled');
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn(
      "[email] SMTP not configured. Emails will not be sent.",
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  return transporter;
}

const i18n = {
  tr: {
    verifySubject: "E-posta adresinizi dogrulayın",
    verifyBody: (url: string) =>
      `Merhaba,\n\nE-posta adresinizi dogrulamak icin asagıdaki bağlantıya tıklayın:\n\n${url}\n\nBu bağlantı 24 saat boyunca gecerlidir.\n\nQulo Ekibi`,
    resetSubject: "Sifre sıfırlama talebi",
    resetBody: (url: string) =>
      `Merhaba,\n\nSifrenizi sıfırlamak icin asagıdaki bağlantıya tıklayın:\n\n${url}\n\nBu bağlantı 1 saat boyunca gecerlidir.\n\nEger bu talebi siz yapmadıysanız, bu e-postayı gormezden gelebilirsiniz.\n\nQulo Ekibi`,
  },
  en: {
    verifySubject: "Verify your email address",
    verifyBody: (url: string) =>
      `Hello,\n\nPlease verify your email address by clicking the link below:\n\n${url}\n\nThis link is valid for 24 hours.\n\nQulo Team`,
    resetSubject: "Password reset request",
    resetBody: (url: string) =>
      `Hello,\n\nClick the link below to reset your password:\n\n${url}\n\nThis link is valid for 1 hour.\n\nIf you did not request this, you can ignore this email.\n\nQulo Team`,
  },
} as const;

type Locale = keyof typeof i18n;

function getLocale(locale?: string): Locale {
  return locale === "tr" ? "tr" : "en";
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

  const loc = getLocale(locale);
  const url = `${env.APP_URL}/api/v1/auth/verify-email?token=${token}`;

  await t.sendMail({
    from: env.SMTP_USER,
    to,
    subject: i18n[loc].verifySubject,
    text: i18n[loc].verifyBody(url),
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

  const loc = getLocale(locale);
  const url = `${env.APP_URL}/reset-password?token=${token}`;

  await t.sendMail({
    from: env.SMTP_USER,
    to,
    subject: i18n[loc].resetSubject,
    text: i18n[loc].resetBody(url),
  });
}
