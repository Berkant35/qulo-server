import { supabase } from "../config/supabase.js";
import { antiCheatConfigService } from "./anti-cheat-config.service.js";
import { stableHashPct, seedFromString } from "../utils/seeded-shuffle.js";
import type {
  AntiCheatRule,
  AntiCheatOutcome,
} from "../types/anti-cheat-config.schema.js";

interface DecisionContext {
  rule: AntiCheatRule;
  viewerId?: string | null;
  targetId?: string | null;
  sessionId?: string | null;
  outcome: AntiCheatOutcome;
  reason?: Record<string, unknown>;
}

interface ProximityViewer {
  id: string;
  location?: { lat: number; lng: number } | null;
  ip?: string | null;
}

interface ProximityCheckResult {
  hide: boolean;
  reason?: Record<string, unknown>;
}

class AntiCheatService {
  // ── L1: Proximity + IP exclusion ────────────────────────────
  async shouldHideTargetInDiscover(
    viewer: ProximityViewer,
    targetId: string,
  ): Promise<boolean> {
    const config = (await antiCheatConfigService.getConfig()).proximity_exclusion;

    if (!config.enabled) return false;

    if (config.require_location && !viewer.location) {
      return false;
    }

    // Dev/local bypass: localhost IPs do not exclude anyone.
    if (viewer.ip && (viewer.ip === "127.0.0.1" || viewer.ip === "::1")) {
      return false;
    }

    const result = await this.checkProximityHit(viewer, targetId, config);

    // Real enforcement vs dry-run
    if (config.dry_run) {
      if (result.hide) {
        await this.log({
          rule: "proximity_exclusion",
          viewerId: viewer.id,
          targetId,
          outcome: "DRY_RUN_BLOCKED",
          reason: result.reason,
        });
      }
      return false; // never enforce in dry-run
    }

    const inRollout = stableHashPct(viewer.id) < config.rollout_pct;
    if (!inRollout) return false;

    if (result.hide) {
      await this.log({
        rule: "proximity_exclusion",
        viewerId: viewer.id,
        targetId,
        outcome: "BLOCKED",
        reason: result.reason,
      });
      return true;
    }

    return false;
  }

  private async checkProximityHit(
    viewer: ProximityViewer,
    targetId: string,
    config: {
      radius_meters: number;
      ttl_hours: number;
      ip_match_also: boolean;
    },
  ): Promise<ProximityCheckResult> {
    const cutoff = new Date(
      Date.now() - config.ttl_hours * 60 * 60 * 1000,
    ).toISOString();

    let geomMatch: { solver_id: string; distance_m: number } | null = null;
    if (viewer.location) {
      const { data, error } = await supabase.rpc("anti_cheat_proximity_hit", {
        p_target_id: targetId,
        p_viewer_id: viewer.id,
        p_lng: viewer.location.lng,
        p_lat: viewer.location.lat,
        p_radius_m: config.radius_meters,
        p_cutoff: cutoff,
      });
      if (!error && data && Array.isArray(data) && data.length > 0) {
        geomMatch = data[0] as { solver_id: string; distance_m: number };
      }
    }

    if (geomMatch) {
      return {
        hide: true,
        reason: {
          match_type: "location",
          matched_solver: geomMatch.solver_id,
          distance_m: geomMatch.distance_m,
        },
      };
    }

    if (config.ip_match_also && viewer.ip) {
      const { data: ipMatch } = await supabase
        .from("quiz_sessions")
        .select("solver_id, start_ip, started_at")
        .eq("target_id", targetId)
        .eq("start_ip", viewer.ip)
        .neq("solver_id", viewer.id)
        .gte("started_at", cutoff)
        .limit(1)
        .maybeSingle();

      if (ipMatch) {
        return {
          hide: true,
          reason: {
            match_type: "ip",
            matched_solver: (ipMatch as { solver_id: string }).solver_id,
            ip: viewer.ip,
          },
        };
      }
    }

    return { hide: false };
  }

  // ── L2b: Min think-time ──────────────────────────────────────
  async enforceMinThinkTime(
    sessionId: string,
    viewerId: string,
    targetId: string | null,
    lastQServedAt: Date | null,
  ): Promise<{ ok: true } | { ok: false; waitMs: number }> {
    const config = (await antiCheatConfigService.getConfig()).min_think_time;
    if (!config.enabled) return { ok: true };
    if (!lastQServedAt) return { ok: true };

    const elapsedMs = Date.now() - lastQServedAt.getTime();
    const minMs = Math.round(config.min_seconds * 1000);
    if (elapsedMs >= minMs) return { ok: true };

    const waitMs = minMs - elapsedMs;

    if (config.dry_run) {
      await this.log({
        rule: "min_think_time",
        viewerId,
        targetId,
        sessionId,
        outcome: "DRY_RUN_BLOCKED",
        reason: { elapsed_ms: elapsedMs, min_ms: minMs },
      });
      return { ok: true };
    }

    await this.log({
      rule: "min_think_time",
      viewerId,
      targetId,
      sessionId,
      outcome: "BLOCKED",
      reason: { elapsed_ms: elapsedMs, min_ms: minMs },
    });
    return { ok: false, waitMs };
  }

  // ── L2a/L2c knobs ────────────────────────────────────────────
  async dripEnabled(): Promise<boolean> {
    const c = (await antiCheatConfigService.getConfig()).drip_questions;
    return c.enabled && !c.dry_run;
  }

  async shuffleEnabled(): Promise<boolean> {
    const c = (await antiCheatConfigService.getConfig()).viewer_specific_shuffle;
    return c.enabled && !c.dry_run;
  }

  seedFromSession(sessionId: string): number {
    return seedFromString(sessionId);
  }

  // ── Decision log ─────────────────────────────────────────────
  private async log(ctx: DecisionContext): Promise<void> {
    try {
      await supabase.from("anti_cheat_decisions").insert({
        rule: ctx.rule,
        viewer_id: ctx.viewerId ?? null,
        target_id: ctx.targetId ?? null,
        session_id: ctx.sessionId ?? null,
        outcome: ctx.outcome,
        reason: ctx.reason ?? null,
      });
    } catch (err) {
      console.error("[anti-cheat] log insert failed", err);
    }
  }
}

export const antiCheatService = new AntiCheatService();
