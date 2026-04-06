import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import { sendEmail } from "../utils/gmail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
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

    await sendEmail({
      to,
      subject: `Re: ${subject} - Qulo Support`,
      html,
      text: `${subject}\n\n${replyText}\n\nTicket ID: ${ticketId}`,
    });
  }
}

export const emailService = new EmailService();
