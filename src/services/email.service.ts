import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      if (!env.SMTP_HOST) {
        this.transporter = nodemailer.createTransport({ jsonTransport: true });
        return this.transporter;
      }
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: (env.SMTP_PORT ?? 587) === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
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

    const info = await this.getTransporter().sendMail({
      from: env.SMTP_FROM ?? "noreply@quloapp.com",
      to,
      subject: `Re: ${subject} - Qulo Support`,
      html,
    });

    if (!env.SMTP_HOST) {
      console.log(
        "[email] Dev mode - would send:",
        JSON.parse((info as { message: string }).message),
      );
    }
  }
}

export const emailService = new EmailService();
