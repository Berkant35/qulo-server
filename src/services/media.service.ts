import { supabase } from "../config/supabase.js";
import { NotificationService } from "./notification.service.js";
import { Errors } from "../utils/errors.js";
import { assertUuid } from "../utils/validation.js";

interface MatchWithMedia {
  id: string;
  user1_id: string;
  user2_id: string;
  is_active: boolean;
  media_enabled_by_user1: boolean;
  media_enabled_by_user2: boolean;
}

export class MediaService {
  private async verifyMatchAccess(userId: string, matchId: string): Promise<MatchWithMedia> {
    assertUuid(userId, "userId");
    assertUuid(matchId, "matchId");

    const { data: match, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active, media_enabled_by_user1, media_enabled_by_user2")
      .eq("id", matchId)
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .single();

    if (error || !match) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    return match as MatchWithMedia;
  }

  async requestMedia(matchId: string, requesterId: string) {
    const match = await this.verifyMatchAccess(requesterId, matchId);

    // Check if both media already enabled
    if (match.media_enabled_by_user1 && match.media_enabled_by_user2) {
      throw Errors.MEDIA_ALREADY_ENABLED();
    }

    // Check if pending request exists
    const { data: pending } = await supabase
      .from("media_requests")
      .select("id")
      .eq("match_id", match.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (pending) {
      throw Errors.MEDIA_REQUEST_PENDING();
    }

    // Determine position and set requester's media flag
    const isUser1 = match.user1_id === requesterId;
    const column = isUser1 ? "media_enabled_by_user1" : "media_enabled_by_user2";

    const { error: updateError } = await supabase
      .from("matches")
      .update({ [column]: true })
      .eq("id", match.id);

    if (updateError) {
      console.error("[media] requestMedia update error:", updateError);
      throw Errors.SERVER_ERROR();
    }

    // Insert media request
    const { data: request, error: insertError } = await supabase
      .from("media_requests")
      .insert({
        match_id: match.id,
        requester_id: requesterId,
        status: "pending",
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("[media] requestMedia insert error:", insertError);
      throw Errors.SERVER_ERROR();
    }

    // Notify the other user
    const otherUserId = isUser1 ? match.user2_id : match.user1_id;
    NotificationService.getUserDisplayName(requesterId).then((senderName) =>
      NotificationService.sendPush(otherUserId, "new_message", { name: senderName }, undefined, {
        actionUrl: `/chat/${match.id}`,
      }),
    ).catch((err) => {
      console.warn('[media] Push notification failed (requestMedia):', err?.message ?? err);
    });

    return request;
  }

  async respondToRequest(requestId: string, userId: string, action: "accept" | "reject") {
    assertUuid(requestId, "requestId");

    // Fetch request
    const { data: request, error: fetchError } = await supabase
      .from("media_requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchError || !request) {
      throw Errors.MEDIA_REQUEST_NOT_FOUND();
    }

    if (request.status !== "pending") {
      throw Errors.MEDIA_REQUEST_NOT_FOUND();
    }

    // Verify userId is NOT the requester
    if (request.requester_id === userId) {
      throw Errors.MEDIA_REQUEST_NOT_RECIPIENT();
    }

    // Verify match access
    const match = await this.verifyMatchAccess(userId, request.match_id);

    const now = new Date().toISOString();

    if (action === "accept") {
      // Update request status
      const { error: updateReqError } = await supabase
        .from("media_requests")
        .update({ status: "accepted", responded_at: now })
        .eq("id", requestId);

      if (updateReqError) {
        console.error("[media] respondToRequest accept error:", updateReqError);
        throw Errors.SERVER_ERROR();
      }

      // Set responder's media flag to true
      const isUser1 = match.user1_id === userId;
      const column = isUser1 ? "media_enabled_by_user1" : "media_enabled_by_user2";

      const { error: updateMatchError } = await supabase
        .from("matches")
        .update({ [column]: true })
        .eq("id", match.id);

      if (updateMatchError) {
        console.error("[media] respondToRequest match update error:", updateMatchError);
        throw Errors.SERVER_ERROR();
      }

      // Notify requester (userId = responder, so that's the "sender name")
      NotificationService.getUserDisplayName(userId).then((senderName) =>
        NotificationService.sendPush(request.requester_id, "new_message", { name: senderName }, undefined, {
          actionUrl: `/chat/${match.id}`,
        }),
      ).catch((err) => {
        console.warn('[media] Push notification failed (respondToRequest):', err?.message ?? err);
      });

      return { status: "accepted", media_enabled: true };
    } else {
      // Reject: update request status
      const { error: updateReqError } = await supabase
        .from("media_requests")
        .update({ status: "rejected", responded_at: now })
        .eq("id", requestId);

      if (updateReqError) {
        console.error("[media] respondToRequest reject error:", updateReqError);
        throw Errors.SERVER_ERROR();
      }

      // Reset requester's media flag back to false
      const isRequesterUser1 = match.user1_id === request.requester_id;
      const requesterColumn = isRequesterUser1 ? "media_enabled_by_user1" : "media_enabled_by_user2";

      const { error: updateMatchError } = await supabase
        .from("matches")
        .update({ [requesterColumn]: false })
        .eq("id", match.id);

      if (updateMatchError) {
        console.error("[media] respondToRequest match reset error:", updateMatchError);
        throw Errors.SERVER_ERROR();
      }

      return { status: "rejected", media_enabled: false };
    }
  }

  async disableMedia(matchId: string, userId: string) {
    const match = await this.verifyMatchAccess(userId, matchId);

    // Set BOTH flags to false
    const { error: updateError } = await supabase
      .from("matches")
      .update({
        media_enabled_by_user1: false,
        media_enabled_by_user2: false,
      })
      .eq("id", match.id);

    if (updateError) {
      console.error("[media] disableMedia update error:", updateError);
      throw Errors.SERVER_ERROR();
    }

    // Delete pending media requests for this match
    const { error: deleteError } = await supabase
      .from("media_requests")
      .delete()
      .eq("match_id", match.id)
      .eq("status", "pending");

    if (deleteError) {
      console.error("[media] disableMedia delete error:", deleteError);
      throw Errors.SERVER_ERROR();
    }

    return { success: true };
  }

  async getMediaStatus(matchId: string, userId: string) {
    const match = await this.verifyMatchAccess(userId, matchId);

    const isUser1 = match.user1_id === userId;
    const myEnabled = isUser1 ? match.media_enabled_by_user1 : match.media_enabled_by_user2;
    const otherEnabled = isUser1 ? match.media_enabled_by_user2 : match.media_enabled_by_user1;

    // Fetch latest pending request for this match
    const { data: pendingRequest } = await supabase
      .from("media_requests")
      .select("id, requester_id, status, created_at")
      .eq("match_id", match.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      media_enabled: myEnabled && otherEnabled,
      my_enabled: myEnabled,
      other_enabled: otherEnabled,
      pending_request: pendingRequest ?? null,
    };
  }
}

export const mediaService = new MediaService();
