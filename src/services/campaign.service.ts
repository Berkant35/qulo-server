import { supabase } from "../config/supabase.js";
import { isFcmAvailable } from "../config/firebase.js";
import { NotificationService } from "./notification.service.js";
import type {
  SegmentInput,
  CreateCampaignInput,
} from "../validators/campaign.validator.js";

const BATCH_SIZE = 500;

class CampaignService {
  // ── Segment query builder ──────────────────────────────────────────
  private buildSegmentQuery(segment: SegmentInput) {
    let query = supabase
      .from("users")
      .select("id, push_token", { count: "exact" })
      .eq("is_deleted", false);

    if (segment.gender) {
      query = query.eq("gender", segment.gender);
    }
    if (segment.age_min !== undefined) {
      query = query.gte("age", segment.age_min);
    }
    if (segment.age_max !== undefined) {
      query = query.lte("age", segment.age_max);
    }
    if (segment.cities?.length) {
      query = query.in("city", segment.cities);
    }
    if (segment.subscription_plan) {
      query = query.eq("subscription_plan", segment.subscription_plan);
    }
    if (segment.last_active_days !== undefined) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - segment.last_active_days);
      query = query.gte("last_seen_at", sinceDate.toISOString());
    }
    if (segment.profile_completion_min !== undefined) {
      query = query.gte("profile_completion", segment.profile_completion_min);
    }
    if (segment.profile_completion_max !== undefined) {
      query = query.lte("profile_completion", segment.profile_completion_max);
    }
    if (segment.registered_after) {
      query = query.gte("created_at", segment.registered_after);
    }

    return query;
  }

  // ── Preview segment count ──────────────────────────────────────────
  async previewSegmentCount(segment: SegmentInput): Promise<number> {
    const { count, error } = await this.buildSegmentQuery(segment);
    if (error) throw error;
    return count ?? 0;
  }

  // ── Create campaign ────────────────────────────────────────────────
  async createCampaign(data: CreateCampaignInput, adminId: string) {
    const status = data.scheduled_at ? "scheduled" : "draft";

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
      .select("*")
      .eq("id", campaignId)
      .single();

    if (getErr || !campaign) throw getErr ?? new Error("Campaign not found");
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      throw new Error(`Campaign already ${campaign.status}`);
    }

    // 2. Set status → sending
    await supabase
      .from("campaigns")
      .update({ status: "sending" })
      .eq("id", campaignId);

    try {
      // 3. Build segment query and get all matching users
      const { data: users, count, error: segErr } = await this.buildSegmentQuery(
        campaign.segment as SegmentInput,
      );
      if (segErr) throw segErr;

      const allUsers = users ?? [];

      // 4. Update total_targeted
      await supabase
        .from("campaign_stats")
        .update({ total_targeted: count ?? allUsers.length })
        .eq("campaign_id", campaignId);

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
          await supabase.from("campaign_events").insert(events);
        }
      }

      console.log(`[CampaignService] Campaign ${campaignId} completed: ${totalDelivered}/${totalSent} delivered, ${allUsers.length} targeted`);

      // 6. Update campaign_stats
      await supabase
        .from("campaign_stats")
        .update({ total_sent: totalSent, total_delivered: totalDelivered })
        .eq("campaign_id", campaignId);

      // 7. Set status → sent
      await supabase
        .from("campaigns")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", campaignId);

      return { totalSent, totalDelivered, totalTargeted: count ?? allUsers.length };
    } catch (err) {
      // Revert to draft on failure
      await supabase
        .from("campaigns")
        .update({ status: "draft" })
        .eq("id", campaignId);
      throw err;
    }
  }

  // ── Cancel campaign ────────────────────────────────────────────────
  async cancelCampaign(campaignId: string) {
    const { data: campaign, error: getErr } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .single();

    if (getErr || !campaign) throw getErr ?? new Error("Campaign not found");
    if (campaign.status !== "draft" && campaign.status !== "scheduled") {
      throw new Error("Can only cancel draft or scheduled campaigns");
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "cancelled" })
      .eq("id", campaignId);

    if (error) throw error;
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
      .single();

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
