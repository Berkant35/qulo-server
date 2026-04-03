import { Resend } from "resend";
import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
  private resend: Resend | null = null;

  private getResend(): Resend | null {
    if (this.resend) return this.resend;
    if (!env.RESEND_API_KEY) {
      console.warn("[email.service] Resend not configured — ticket emails disabled");
      return null;
    }
    this.resend = new Resend(env.RESEND_API_KEY);
    return this.resend;
  }

  async sendTicketReply(
    to: string,
    subject: string,
    replyText: string,
    ticketId: string,
  ): Promise<void> {
    const templatePath = path.join(
      __dirname,
      "../admin/views/emails/ticket-reply.ejs",
    );
    const html = await ejs.renderFile(templatePath, {
      subject,
      replyText,
      ticketId,
    });

    const r = this.getResend();
    if (!r) {
      console.log("[email.service] Dev mode - would send ticket reply to:", to);
      return;
    }

    const { error } = await r.emails.send({
      from: `Qulo Support <${env.SMTP_FROM}>`,
      to,
      subject: `Re: ${subject} - Qulo Support`,
      html,
    });

    if (error) {
      console.error("[email.service] Failed to send ticket reply:", error.message);
      throw new Error(error.message);
    }
  }
}

export const emailService = new EmailService();
