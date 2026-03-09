import { supabase } from "../config/supabase.js";

class NotificationApiService {
  // Get paginated notifications for user
  async getNotifications(userId: string, page: number, limit: number) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    return { notifications: data ?? [], total: count ?? 0 };
  }

  // Get unread count
  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) throw error;
    return count ?? 0;
  }

  // Mark single notification as read + track opened event if campaign
  async markAsRead(userId: string, notificationId: string) {
    const { data: notif } = await supabase
      .from("notifications")
      .select("campaign_id, is_read")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .single();
    if (!notif) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notificationId)
      .eq("user_id", userId);

    // First time read + has campaign → track opened event
    if (!notif.is_read && notif.campaign_id) {
      await supabase.from("campaign_events").insert({
        campaign_id: notif.campaign_id,
        user_id: userId,
        event: "opened",
      });
      await supabase.rpc("increment_campaign_stat", {
        p_campaign_id: notif.campaign_id,
        p_field: "total_opened",
      });
    }
  }

  // Mark all unread as read
  async markAllAsRead(userId: string) {
    // Get unread campaign notifications first for event tracking
    const { data: unreadCampaign } = await supabase
      .from("notifications")
      .select("id, campaign_id")
      .eq("user_id", userId)
      .eq("is_read", false)
      .not("campaign_id", "is", null);

    // Mark all as read
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    // Track opened events for campaign notifications
    if (unreadCampaign?.length) {
      const events = unreadCampaign.map((n) => ({
        campaign_id: n.campaign_id,
        user_id: userId,
        event: "opened" as const,
      }));
      await supabase.from("campaign_events").insert(events);
      // Increment stats for each unique campaign
      const campaignIds = [...new Set(unreadCampaign.map((n) => n.campaign_id))];
      await Promise.all(
        campaignIds.map((cId) =>
          supabase.rpc("increment_campaign_stat", {
            p_campaign_id: cId,
            p_field: "total_opened",
          }),
        ),
      );
    }
  }

  // Track CTA button click
  async trackClick(userId: string, notificationId: string) {
    const { data: notif } = await supabase
      .from("notifications")
      .select("campaign_id")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .single();
    if (!notif?.campaign_id) return;

    await supabase.from("campaign_events").insert({
      campaign_id: notif.campaign_id,
      user_id: userId,
      event: "clicked",
    });
    await supabase.rpc("increment_campaign_stat", {
      p_campaign_id: notif.campaign_id,
      p_field: "total_clicked",
    });
  }
}

export const notificationApiService = new NotificationApiService();
