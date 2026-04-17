import { google } from "googleapis";
import { env } from "../config/env.js";
import { maskEmail } from "./pii.js";

let gmailClient: ReturnType<typeof google.gmail> | null = null;

function getGmailClient() {
  if (gmailClient) return gmailClient;

  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: env.EMAIL_FROM,
  });

  gmailClient = google.gmail({ version: "v1", auth });
  return gmailClient;
}

function buildRawEmail(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: "Qulo" <${options.from}>`,
    `To: ${options.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(options.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.text).toString("base64"),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.html).toString("base64"),
    "",
    `--${boundary}--`,
  ];

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<string | null> {
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  if (!key.client_email || !key.private_key) {
    console.warn("[gmail] Email skipped — GOOGLE_SERVICE_ACCOUNT_KEY not configured");
    return null;
  }

  const gmail = getGmailClient();
  const raw = buildRawEmail({
    from: env.EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    console.log(`[gmail] Email sent to ${maskEmail(options.to)}, messageId: ${res.data.id}`);
    return res.data.id ?? null;
  } catch (err: unknown) {
    console.error(`[gmail] Failed to send email to ${maskEmail(options.to)}:`, err instanceof Error ? err.message : err);
    throw err;
  }
}
