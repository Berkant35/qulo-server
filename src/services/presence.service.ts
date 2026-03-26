import { supabase } from "../config/supabase.js";

export class PresenceService {
  /** Update user's last_seen_at and set is_online = true */
  static async heartbeat(userId: string): Promise<void> {
    await supabase
      .from("users")
      .update({
        last_seen_at: new Date().toISOString(),
        is_online: true,
      })
      .eq("id", userId);
  }

  /** Set a specific user offline */
  static async setOffline(userId: string): Promise<void> {
    await supabase
      .from("users")
      .update({ is_online: false })
      .eq("id", userId);
  }

  /** Mark all users as offline if last_seen_at > threshold minutes ago */
  static async expireInactiveUsers(thresholdMinutes: number = 3): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("users")
      .update({ is_online: false })
      .eq("is_online", true)
      .lt("last_seen_at", cutoff)
      .select("id");

    if (error) {
      console.error("[PresenceCron] Error expiring inactive users:", error.message);
      return 0;
    }

    return data?.length ?? 0;
  }
}
