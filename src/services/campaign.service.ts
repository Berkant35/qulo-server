import { supabase } from "../config/supabase.js";
import { isFcmAvailable } from "../config/firebase.js";
import { NotificationService } from "./notification.service.js";
import { segmentService } from "./segment.service.js";
import { fetchAll, isEligibleUser } from "./notification-engine/context.js";
import { DAY_MS } from "./notification-engine/timezone.js";
import { isRecurring } from "../validators/campaign.validator.js";
import type {
  SegmentInput,
  CreateCampaignInput,
} from "../validators/campaign.validator.js";

const BATCH_SIZE = 500;
/** Tekrarlayan kampanya calisir durumda mi (scheduled) / duraklatildi mi. */
export type RecurringState = "scheduled" | "paused";

function warnIfError(step: string, campaignId: string, error: { message: string } | null): void {
  if (error) console.warn(`[CampaignService] ${step} yazilamadi (${campaignId}):`, error.message);
}

class CampaignService {
  // ── Preview segment count (delegated to segmentService) ───────────
  async previewSegmentCount(segment: SegmentInput): Promise<number> {
    return segmentService.previewSegmentCount(segment);
  }

  // ── Create campaign ────────────────────────────────────────────────
  async createCampaign(data: CreateCampaignInput, adminId: string) {
    // Tekrarlayan kampanya dogdugu anda calisir (scheduled); durdurmak icin pause/cancel.
    const status = isRecurring(data) || data.scheduled_at ? "scheduled" : "draft";

    const { data: campaign, error } = await supabase
      .from("campaigns")
      .insert({
        title: data.title,
        push_title: data.push_title,
        push_body: data.push_body,
        image_url: data.image_url ?? null,
        action_url: data.action_url ?? null,
        action_label: data.action_label ?? null,
        segment: data.segment,
        scheduled_at: data.scheduled_at ?? null,
        recurrence: data.recurrence,
        recurrence_days: data.recurrence_days ?? null,
        window_start_hour: data.window_start_hour ?? null,
        window_end_hour: data.window_end_hour ?? null,
        variants: data.variants,
        status,
        created_by: adminId,
      })
      .select("*")
      .single();

    if (error) throw error;

    // Create stats record
    const { error: statsError } = await supabase
      .from("campaign_stats")
      .insert({ campaign_id: campaign.id });

    if (statsError) throw statsError;

    return campaign;
  }

  // ── Send campaign ──────────────────────────────────────────────────
  async sendCampaign(campaignId: string) {
    // 0. Pre-flight: check FCM availability
    if (!isFcmAvailable()) {
      throw new Error("FCM not configured — FIREBASE_SERVICE_ACCOUNT is missing or invalid");
    }

    // 1. Get campaign and validate status
    const { data: campaign, error: getErr } = await supabase
      .from("campaigns")
      .select("id, status, recurrence, segment, push_title, push_body, image_url, action_url, action_label")
      .eq("id", campaignId)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      throw new Error(`Campaign already ${campaign.status}`);
    }
    if (isRecurring(campaign)) {
      throw new Error("Recurring campaigns are sent by the dispatcher, not manually");
    }

    // 2. Set status → sending
    await supabase
      .from("campaigns")
      .update({ status: "sending" })
      .eq("id", campaignId);

    try {
      // 3. Segment (sayfali) + uygunluk: test/seed/banli hedef sayilmaz (motorla ayni kural)
      const allUsers = (await segmentService.listSegmentTargets(campaign.segment as SegmentInput)).filter(isEligibleUser);

      // 4. Update total_targeted
      const { error: targetedErr } = await supabase
        .from("campaign_stats")
        .update({ total_targeted: allUsers.length })
        .eq("campaign_id", campaignId);
      warnIfError("total_targeted", campaignId, targetedErr);

      // 5. Batch send
      let totalSent = 0;
      let totalDelivered = 0;

      for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
        const batch = allUsers.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map((user) =>
            NotificationService.sendPush(user.id, "campaign", { body: campaign.push_body }, undefined, {
              title: campaign.push_title,
              imageUrl: campaign.image_url ?? undefined,
              actionUrl: campaign.action_url ?? undefined,
              actionLabel: campaign.action_label ?? undefined,
              campaignId,
            }),
          ),
        );

        // Build campaign_events for this batch — only count actual FCM sends
        const events: Array<{
          campaign_id: string;
          user_id: string;
          event: string;
        }> = [];

        for (let j = 0; j < batch.length; j++) {
          const user = batch[j];
          const result = results[j];

          // sendPush returns boolean: true = FCM actually sent
          const fcmSent = result.status === "fulfilled" && result.value === true;

          if (fcmSent) {
            totalSent++;
            totalDelivered++;
            events.push(
              { campaign_id: campaignId, user_id: user.id, event: "sent" },
              { campaign_id: campaignId, user_id: user.id, event: "delivered" },
            );
          } else {
            // DB notification saved but FCM push failed/skipped
            events.push({
              campaign_id: campaignId,
              user_id: user.id,
              event: "sent",
            });
            totalSent++;
          }
        }

        if (events.length) {
          const { error: eventsErr } = await supabase.from("campaign_events").insert(events);
          warnIfError("campaign_events", campaignId, eventsErr);
        }
      }

      console.log(`[CampaignService] Campaign ${campaignId} completed: ${totalDelivered}/${totalSent} delivered, ${allUsers.length} targeted`);

      // 6. Update campaign_stats
      const { error: statsErr } = await supabase
        .from("campaign_stats")
        .update({ total_sent: totalSent, total_delivered: totalDelivered })
        .eq("campaign_id", campaignId);
      warnIfError("campaign_stats", campaignId, statsErr);

      // 7. Set status → sent
      await supabase
        .from("campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", campaignId);

      return { totalSent, totalDelivered, totalTargeted: allUsers.length };
    } catch (err) {
      // Revert to draft on failure
      await supabase
        .from("campaigns")
        .update({ status: "draft" })
        .eq("id", campaignId);
      throw err;
    }
  }

  // ── Vadesi gelen planli kampanyalar (notification-engine cron'undan) ──
  async dispatchDueCampaigns(now: Date = new Date()): Promise<{ dispatched: string[]; failed: string[] }> {
    // FCM yapilandirilmamissa sendCampaign her kampanya icin firlatirdi; kampanyalar 'scheduled' kalir,
    // yapilandirma duzelince kendiliginden gider.
    if (!isFcmAvailable()) {
      console.warn("[CampaignService] FCM not configured — scheduled campaigns stay queued");
      return { dispatched: [], failed: [] };
    }
    const { data, error } = await supabase
      .from("campaigns")
      .select("id")
      .eq("status", "scheduled")
      .eq("recurrence", "none")
      .lte("scheduled_at", now.toISOString());
    if (error) throw error;

    const dispatched: string[] = [];
    const failed: string[] = [];
    for (const row of (data ?? []) as Array<{ id: string }>) {
      try {
        await this.sendCampaign(row.id);
        dispatched.push(row.id);
      } catch (err) {
        // Gonderim sirasinda hata: sendCampaign kampanyayi draft'a ceker (tekrar yok, admin panelde gorunur).
        console.error(`[CampaignService] Scheduled campaign ${row.id} failed:`, err instanceof Error ? err.message : err);
        failed.push(row.id);
      }
    }
    return { dispatched, failed };
  }

  // ── Cancel campaign ────────────────────────────────────────────────
  async cancelCampaign(campaignId: string) {
    const { data: campaign, error: getErr } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status !== "draft" && campaign.status !== "scheduled" && campaign.status !== "paused") {
      throw new Error("Can only cancel draft, scheduled or paused campaigns");
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "cancelled" })
      .eq("id", campaignId);

    if (error) throw error;
  }

  // ── Tekrarlayan kampanya: duraklat / surdur ───────────────────────
  async setRecurringState(campaignId: string, state: RecurringState) {
    const { data: campaign, error: getErr } = await supabase
      .from("campaigns")
      .select("status, recurrence")
      .eq("id", campaignId)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!campaign) throw new Error("Campaign not found");
    if (!isRecurring(campaign)) throw new Error("Only recurring campaigns can be paused/resumed");
    const allowedFrom: RecurringState = state === "paused" ? "scheduled" : "paused";
    if (campaign.status !== allowedFrom) throw new Error(`Campaign is ${campaign.status}, cannot set ${state}`);

    const { error } = await supabase.from("campaigns").update({ status: state }).eq("id", campaignId);
    if (error) throw error;
  }

  // ── Tekrarlayan kampanya: son N gunun gunluk gonderim/teslim sayilari (UTC gun) ──
  async getRecurringDailyStats(campaignId: string, days = 7): Promise<Array<{ day: string; sent: number; delivered: number }>> {
    const since = new Date(Date.now() - days * DAY_MS).toISOString();
    const rows = await fetchAll<{ event: string; created_at: string }>((from, to) =>
      supabase.from("campaign_events").select("event, created_at").eq("campaign_id", campaignId).gte("created_at", since).order("id").range(from, to),
    );

    const byDay = new Map<string, { day: string; sent: number; delivered: number }>();
    for (const row of rows) {
      const day = row.created_at.slice(0, 10);
      const entry = byDay.get(day) ?? { day, sent: 0, delivered: 0 };
      if (row.event === "sent") entry.sent++;
      else if (row.event === "delivered") entry.delivered++;
      byDay.set(day, entry);
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  // ── List campaigns (paginated) ─────────────────────────────────────
  async getCampaigns(page: number, limit: number) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await supabase
      .from("campaigns")
      .select("*, campaign_stats(*)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;
    return { campaigns: data ?? [], total: count ?? 0 };
  }

  // ── Campaign detail ────────────────────────────────────────────────
  async getCampaignDetail(campaignId: string) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*, campaign_stats(*)")
      .eq("id", campaignId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // ── Campaign breakdown (for analytics) ─────────────────────────────
  async getCampaignBreakdown(campaignId: string) {
    const { data: events, error } = await supabase
      .from("campaign_events")
      .select("event, user_id, created_at, users(gender)")
      .eq("campaign_id", campaignId);

    if (error) throw error;
    return events ?? [];
  }
}

export const campaignService = new CampaignService();
