import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

class SupportTicketService {
  async create(
    userId: string,
    subject: string,
    message: string,
    category: string,
  ) {
    const { data, error } = await supabase
      .from("support_tickets")
      .insert({ user_id: userId, subject, message, category })
      .select("id, subject, message, category, status, created_at")
      .single();

    if (error) throw Errors.SERVER_ERROR();
    return data;
  }

  async listByUser(userId: string) {
    const { data, error } = await supabase
      .from("support_tickets")
      .select(
        "id, subject, category, status, admin_reply, replied_at, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw Errors.SERVER_ERROR();
    return data ?? [];
  }

  async getById(ticketId: string, userId: string) {
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", ticketId)
      .eq("user_id", userId)
      .single();

    if (error) throw Errors.TICKET_NOT_FOUND();
    return data;
  }
}

export const supportTicketService = new SupportTicketService();
