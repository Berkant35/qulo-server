import { supabase } from "../config/supabase.js";
import { NotificationService } from "./notification.service.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";

interface Match {
  id: string;
  user1_id: string;
  user2_id: string;
  is_active: boolean;
}

export class ChatService {
  private async verifyMatchAccess(userId: string, matchId: string): Promise<Match> {
    assertUuid(userId, "userId");
    assertUuid(matchId, "matchId");

    const { data: match, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active")
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (error || !match) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    return match as Match;
  }

  async getMessages(userId: string, matchId: string, page = 1, limit = 30) {
    const match = await this.verifyMatchAccess(userId, matchId);

    const offset = (page - 1) * limit;

    const { data: messages, error, count } = await supabase
      .from("messages")
      .select("*", { count: "exact" })
      .eq("match_id", match.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[chat] getMessages error:", error);
      throw Errors.SERVER_ERROR();
    }

    return {
      messages: messages ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  async sendMessage(userId: string, matchId: string, content: string, isImage = false) {
    const match = await this.verifyMatchAccess(userId, matchId);

    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        match_id: match.id,
        sender_id: userId,
        content,
        is_image: isImage,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[chat] sendMessage error:", error);
      throw Errors.SERVER_ERROR();
    }

    // Determine other user and send push notification
    const otherUserId = match.user1_id === userId ? match.user2_id : match.user1_id;
    const pushType = isImage ? "new_message_image" : "new_message";

    // Fire-and-forget push notification
    NotificationService.sendPush(otherUserId, pushType, {}, undefined, {
      actionUrl: `/matches/chat/${match.id}`,
    }).catch(() => {});

    return message;
  }

  async markAsRead(userId: string, matchId: string) {
    const match = await this.verifyMatchAccess(userId, matchId);

    const { error } = await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("match_id", match.id)
      .neq("sender_id", userId)
      .is("read_at", null);

    if (error) {
      console.error("[chat] markAsRead error:", error);
      throw Errors.SERVER_ERROR();
    }

    return { success: true };
  }
}

export const chatService = new ChatService();
