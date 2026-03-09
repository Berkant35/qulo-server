import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export class DiamondService {
  async getBalance(userId: string) {
    const { data, error } = await supabase
      .from("users")
      .select("green_diamonds, purple_diamonds")
      .eq("id", userId)
      .single();

    if (error || !data) {
      throw Errors.USER_NOT_FOUND();
    }

    return { green: data.green_diamonds, purple: data.purple_diamonds };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from("diamond_transactions")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return {
      items: data ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  async spendPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Read current balance for early validation
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("purple_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    if (user.purple_diamonds < amount) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.purple_diamonds);
    }

    // Atomic decrement — .gte() ensures balance hasn't dropped below amount since read
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ purple_diamonds: user.purple_diamonds - amount })
      .eq("id", userId)
      .gte("purple_diamonds", amount)
      .select("purple_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.purple_diamonds);
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "PURPLE",
        amount: -amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { purple: updated.purple_diamonds };
  }

  async addPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Read current balance
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("purple_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Atomic increment — optimistic lock ensures no concurrent modification
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ purple_diamonds: user.purple_diamonds + amount })
      .eq("id", userId)
      .eq("purple_diamonds", user.purple_diamonds)
      .select("purple_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.SERVER_ERROR();
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "PURPLE",
        amount: +amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { purple: updated.purple_diamonds };
  }

  async earnGreen(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Read current balance
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("green_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Atomic increment — optimistic lock ensures no concurrent modification
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ green_diamonds: user.green_diamonds + amount })
      .eq("id", userId)
      .eq("green_diamonds", user.green_diamonds)
      .select("green_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.SERVER_ERROR();
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "GREEN",
        amount: +amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { green: updated.green_diamonds };
  }

  async spendGreen(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Read current balance for early validation
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("green_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    if (user.green_diamonds < amount) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.green_diamonds);
    }

    // Atomic decrement — .gte() ensures balance hasn't dropped below amount since read
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ green_diamonds: user.green_diamonds - amount })
      .eq("id", userId)
      .gte("green_diamonds", amount)
      .select("green_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.green_diamonds);
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "GREEN",
        amount: -amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { green: updated.green_diamonds };
  }
}

export const diamondService = new DiamondService();
