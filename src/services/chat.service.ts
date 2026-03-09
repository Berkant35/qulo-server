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
      .select("*, reactions:message_reactions(emoji, user_id)", { count: "exact" })
      .eq("match_id", match.id)
      .is("deleted_at", null)
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

  async deleteMessage(userId: string, matchId: string, messageId: string) {
    const match = await this.verifyMatchAccess(userId, matchId);
    assertUuid(messageId, "messageId");

    // Fetch the message to verify ownership
    const { data: message, error: fetchError } = await supabase
      .from("messages")
      .select("id, sender_id")
      .eq("id", messageId)
      .eq("match_id", match.id)
      .is("deleted_at", null)
      .single();

    if (fetchError || !message) {
      throw Errors.MESSAGE_NOT_FOUND();
    }

    if (message.sender_id !== userId) {
      throw Errors.MESSAGE_NOT_OWNER();
    }

    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);

    if (error) {
      console.error("[chat] deleteMessage error:", error);
      throw Errors.SERVER_ERROR();
    }

    return { success: true };
  }

  async addReaction(userId: string, matchId: string, messageId: string, emoji: string) {
    await this.verifyMatchAccess(userId, matchId);
    assertUuid(messageId, "messageId");

    const { error: insertError } = await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: userId, emoji });

    if (insertError) {
      // Unique constraint violation → toggle off (remove reaction)
      if (insertError.code === "23505") {
        const { error: deleteError } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", messageId)
          .eq("user_id", userId)
          .eq("emoji", emoji);

        if (deleteError) {
          console.error("[chat] removeReaction error:", deleteError);
          throw Errors.SERVER_ERROR();
        }

        return { toggled: "removed" as const };
      }

      console.error("[chat] addReaction error:", insertError);
      throw Errors.SERVER_ERROR();
    }

    return { toggled: "added" as const };
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
