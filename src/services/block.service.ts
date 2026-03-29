import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

class BlockService {
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw Errors.CANNOT_BLOCK_SELF();

    const { data, error } = await supabase
      .from("blocks")
      .insert({ blocker_id: blockerId, blocked_id: blockedId })
      .select("id, blocker_id, blocked_id, created_at")
      .single();

    if (error) {
      if (error.code === "23505") throw Errors.ALREADY_BLOCKED();
      throw Errors.SERVER_ERROR();
    }

    // Also unmatch if matched
    await supabase
      .from("matches")
      .update({ is_active: false })
      .or(
        `and(user1_id.eq.${blockerId},user2_id.eq.${blockedId}),and(user1_id.eq.${blockedId},user2_id.eq.${blockerId})`
      );

    return data;
  }

  async unblock(blockerId: string, blockedId: string) {
    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);

    if (error) throw Errors.SERVER_ERROR();
  }

  async isBlocked(userId1: string, userId2: string): Promise<boolean> {
    const { data } = await supabase
      .from("blocks")
      .select("id")
      .or(
        `and(blocker_id.eq.${userId1},blocked_id.eq.${userId2}),and(blocker_id.eq.${userId2},blocked_id.eq.${userId1})`
      )
      .limit(1);

    return (data?.length ?? 0) > 0;
  }

  async getBlockedIds(userId: string): Promise<string[]> {
    const { data } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);

    return (data ?? []).map((b: any) => b.blocked_id);
  }

  async getBlockerIds(userId: string): Promise<string[]> {
    const { data } = await supabase
      .from("blocks")
      .select("blocker_id")
      .eq("blocked_id", userId);

    return (data ?? []).map((b: any) => b.blocker_id);
  }

  async getBlockedUsers(blockerId: string) {
    const { data: blocks, error } = await supabase
      .from("blocks")
      .select("id, blocked_id, created_at")
      .eq("blocker_id", blockerId)
      .order("created_at", { ascending: false });

    if (error) throw Errors.SERVER_ERROR();
    if (!blocks || blocks.length === 0) return [];

    const blockedIds = blocks.map((b: any) => b.blocked_id);
    const { data: users } = await supabase
      .from("users")
      .select("id, name, photos")
      .in("id", blockedIds);

    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return blocks.map((b: any) => ({
      id: b.id,
      blocked_at: b.created_at,
      user: userMap.get(b.blocked_id) ?? { id: b.blocked_id, name: "Unknown", photos: [] },
    }));
  }
}

export const blockService = new BlockService();
