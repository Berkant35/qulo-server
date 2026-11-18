import { sendEmail } from "../utils/gmail.js";
import { renderEmailLayout } from "../utils/email-layout.js";

/** Destek yaniti metinleri sabit Turkcedir (admin tarafi); dil secimi yoktur. */
class EmailService {
  async sendTicketReply(
    to: string,
    subject: string,
    replyText: string,
    ticketId: string,
  ): Promise<void> {
    const html = renderEmailLayout({
      locale: "tr",
      preheader: replyText.slice(0, 120),
      title: subject,
      paragraphs: [replyText],
      footerLines: [
        "Yanıtlamak için uygulamadan yeni bir destek talebi oluşturun.",
        `Ticket #${ticketId.substring(0, 8)}`,
      ],
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
