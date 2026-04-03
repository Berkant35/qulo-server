import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
      return null;
    }
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    return this.transporter;
  }

  async sendTicketReply(
    to: string,
    subject: string,
    replyText: string,
    ticketId: string,
  ): Promise<void> {
    const t = this.getTransporter();
    if (!t) {
      console.log("[email.service] SMTP not configured — ticket reply skipped for:", to);
      return;
    }

    const templatePath = path.join(
      __dirname,
      "../admin/views/emails/ticket-reply.ejs",
    );
    const html = await ejs.renderFile(templatePath, {
      subject,
      replyText,
      ticketId,
    });

    await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `Re: ${subject} - Qulo Support`,
      html,
    });
  }
}

export const emailService = new EmailService();
