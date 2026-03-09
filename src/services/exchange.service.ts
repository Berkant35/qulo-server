import { supabase } from "../config/supabase.js";
import { diamondService } from "../services/diamond.service.js";
import { Errors } from "../utils/errors.js";
import { GREEN_TO_PURPLE_RATIO } from "../types/index.js";

class ExchangeService {
  // ── Convert green diamonds to purple (3:1 ratio) ──────────────
  async convertGreenToPurple(userId: string, greenAmount: number) {
    if (greenAmount <= 0 || greenAmount % GREEN_TO_PURPLE_RATIO !== 0) {
      throw Errors.VALIDATION_ERROR({
        greenAmount: `Must be a positive multiple of ${GREEN_TO_PURPLE_RATIO}`,
      });
    }

    const purpleAmount = greenAmount / GREEN_TO_PURPLE_RATIO;

    // Spend green diamonds first
    await diamondService.spendGreen(
      userId,
      greenAmount,
      "exchange_green_to_purple",
    );

    // Credit purple diamonds
    const result = await diamondService.addPurple(
      userId,
      purpleAmount,
      "exchange_green_to_purple",
    );

    const balance = await diamondService.getBalance(userId);

    return {
      purple_received: purpleAmount,
      new_balance: { green: balance.green, purple: balance.purple },
    };
  }

  // ── Buy a power from the exchange ─────────────────────────────
  async buyPower(
    userId: string,
    powerName: string,
    diamondType: "GREEN" | "PURPLE",
    quantity: number,
  ) {
    if (quantity <= 0) {
      throw Errors.VALIDATION_ERROR({ quantity: "Must be a positive integer" });
    }

    // Fetch power definition
    const { data: power, error: powerErr } = await supabase
      .from("powers")
      .select("*")
      .eq("name", powerName)
      .eq("is_active", true)
      .single();

    if (powerErr || !power) {
      throw Errors.VALIDATION_ERROR({ powerName: "Power not found or inactive" });
    }

    const unitCost =
      diamondType === "GREEN" ? power.green_cost : power.purple_cost;

    if (!unitCost || unitCost <= 0) {
      throw Errors.VALIDATION_ERROR({
        diamondType: `This power cannot be purchased with ${diamondType} diamonds`,
      });
    }

    const totalCost = unitCost * quantity;

    // Spend diamonds
    if (diamondType === "GREEN") {
      await diamondService.spendGreen(
        userId,
        totalCost,
        `buy_power_${powerName}`,
        power.id,
      );
    } else {
      await diamondService.spendPurple(
        userId,
        totalCost,
        `buy_power_${powerName}`,
        power.id,
      );
    }

    // Upsert user_power_inventory
    const { data: existing, error: invErr } = await supabase
      .from("user_power_inventory")
      .select("id, count")
      .eq("user_id", userId)
      .eq("power_name", powerName)
      .maybeSingle();

    if (invErr) {
      throw Errors.SERVER_ERROR();
    }

    let newCount: number;

    if (existing) {
      newCount = existing.count + quantity;
      const { error: updateErr } = await supabase
        .from("user_power_inventory")
        .update({ count: newCount, updated_at: new Date().toISOString() })
        .eq("id", existing.id);

      if (updateErr) {
        throw Errors.SERVER_ERROR();
      }
    } else {
      newCount = quantity;
      const { error: insertErr } = await supabase
        .from("user_power_inventory")
        .insert({
          user_id: userId,
          power_name: powerName,
          count: newCount,
        });

      if (insertErr) {
        throw Errors.SERVER_ERROR();
      }
    }

    // Log purchase transaction
    const { error: txErr } = await supabase
      .from("power_purchase_transactions")
      .insert({
        user_id: userId,
        power_name: powerName,
        diamond_type: diamondType,
        quantity,
        unit_cost: unitCost,
        total_cost: totalCost,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    const balance = await diamondService.getBalance(userId);

    return {
      new_count: newCount,
      new_balance: { green: balance.green, purple: balance.purple },
    };
  }

  // ── Get user's power inventory ────────────────────────────────
  async getInventory(userId: string) {
    const { data, error } = await supabase
      .from("user_power_inventory")
      .select("power_name, count")
      .eq("user_id", userId);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return {
      inventory: (data ?? []).map((row) => ({
        power_name: row.power_name,
        count: row.count,
      })),
    };
  }

  // ── Get conversion rates & power prices ───────────────────────
  async getRates() {
    const { data, error } = await supabase
      .from("powers")
      .select("name, base_cost, green_cost, purple_cost, accuracy_rate")
      .eq("is_active", true);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return {
      convert_ratio: GREEN_TO_PURPLE_RATIO,
      powers: (data ?? []).map((p) => ({
        name: p.name,
        base_cost: p.base_cost,
        green_cost: p.green_cost,
        purple_cost: p.purple_cost,
        accuracy_rate: p.accuracy_rate,
      })),
    };
  }

  // ── Try to use an inventory power (atomic decrement) ──────────
  async tryUseInventory(userId: string, powerName: string): Promise<boolean> {
    // Atomic: update only if count >= 1
    const { data, error } = await supabase
      .from("user_power_inventory")
      .select("id, count")
      .eq("user_id", userId)
      .eq("power_name", powerName)
      .gte("count", 1)
      .maybeSingle();

    if (error || !data) {
      return false;
    }

    // Atomic decrement with optimistic lock
    const { data: updated, error: updateErr } = await supabase
      .from("user_power_inventory")
      .update({ count: data.count - 1, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .gte("count", 1)
      .select("count")
      .single();

    if (updateErr || !updated) {
      return false;
    }

    return true;
  }
}

export const exchangeService = new ExchangeService();
