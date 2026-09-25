import { supabase } from "../config/supabase.js";
import { isFcmAvailable } from "../config/firebase.js";
import { PG_UNIQUE_VIOLATION } from "../constants/postgres.js";
import { NotificationService } from "./notification.service.js";
import { segmentService, type SegmentTarget } from "./segment.service.js";
import { loadEngineConfig } from "./notification-engine/config.js";
import { fetchAll, isEligibleUser, loadSendHistory, sendTimesByUser } from "./notification-engine/context.js";
import { throttleReason, type ThrottleConfig } from "./notification-engine/throttle.js";
import { DAY_MS, localClock, utcOffsetHours, type LocalClock } from "./notification-engine/timezone.js";
import { fnv1a32 } from "../utils/hash.js";
import type { CampaignVariant, SegmentInput } from "../validators/campaign.validator.js";

/**
 * Tekrarlayan (gunluk) kampanya gondericisi — campaign-dispatch cron'undan her 15 dk.
 *
 * Kural: kampanya status='scheduled' & recurrence!='none' iken her kullanici icin, kullanicinin
 * yerel saatine gore (motorla ayni tahmin) o gunun gonderim dakikasi kampanya+gun hash'inden secilir
 * (pencere icinde "rastgele" ama deterministik). Dakika gecince ve pencere kapanmadan gonderilir.
 *
 * "Bogmama" korumasi motorla ORTAK (throttle.ts): ayni holdout kovasi, ayni gunluk (1) / haftalik (3)
 * tavan; kampanya gonderimleri de tavana sayilir. Sonuc: her gun secili bir kampanya, kullanicinin
 * haftalik kotasini tuketip lifecycle bildirimlerini bastirir — backoffice formunda uyarilir, oneri
 * haftada 2-3 gun. Ardisik gunlerin slotlari 20 saatten yakinsa gonderim tavan acilana kadar
 * ayni pencere icinde ertelenir (kayip yok; claim yerel gune bagli).
 *
 * Kayit (campaign_events.dedupe_key = kampanya:kullanici:yerelGun) FCM'den ONCE atilir; unique index
 * ikinci instance'i durdurur.
 */
export interface RecurringCampaign {
  id: string;
  push_title: string;
  push_body: string;
  image_url: string | null;
  action_url: string | null;
  action_label: string | null;
  segment: SegmentInput;
  recurrence_days: number[] | null;
  window_start_hour: number;
  window_end_hour: number;
  variants: CampaignVariant[];
}

export type RecurringSkip =
  | "not_day"
  | "before_slot"
  | "after_window"
  | "already_sent"
  | "holdout"
  | "daily_cap"
  | "weekly_cap"
  | "pref_off"
  | "claimed_elsewhere";

export interface RecurringDispatchResult {
  campaigns: number;
  sent: number;
  failed: number;
  skipped: Record<RecurringSkip, number>;
}

const CAMPAIGN_COLUMNS =
  "id, push_title, push_body, image_url, action_url, action_label, segment, recurrence_days, window_start_hour, window_end_hour, variants";
/** Claim seti icin geriye bakis: yerel gun en fazla UTC+14/-12 kayar, 2 gun her durumda kapsar. */
const CLAIM_LOOKBACK_MS = 2 * DAY_MS;

function emptyResult(): RecurringDispatchResult {
  return {
    campaigns: 0,
    sent: 0,
    failed: 0,
    skipped: { not_day: 0, before_slot: 0, after_window: 0, already_sent: 0, holdout: 0, daily_cap: 0, weekly_cap: 0, pref_off: 0, claimed_elsewhere: 0 },
  };
}

// ── saf parcalar (DB yok; testler dogrudan cagirir) ───────────────────────────

/** Pencere icindeki gonderim dakikasi (yerel, 0-1439) — kampanya+gun icin sabit, gunden gune degisir. */
export function sendMinuteFor(campaignId: string, localDate: string, startHour: number, endHour: number): number {
  const span = Math.max(1, (endHour - startHour) * 60);
  return startHour * 60 + (fnv1a32(`${campaignId}:${localDate}`) % span);
}

/**
 * Gunluk rotasyon, kullanicinin dilinde: once `locale` etiketi kullanicinin diliyle eslesen varyantlar,
 * yoksa etiketsiz (her dile yedek) varyantlar, o da yoksa kampanyanin ana metni. Ardisik gunlerde ardisik varyant.
 */
export function variantFor(
  campaign: Pick<RecurringCampaign, "push_title" | "push_body" | "variants">,
  dayIndex: number,
  userLocale: string | null = null,
): CampaignVariant {
  const forLocale = userLocale ? campaign.variants.filter((v) => v.locale === userLocale) : [];
  const pool = forLocale.length ? forLocale : campaign.variants.filter((v) => !v.locale);
  if (!pool.length) return { title: campaign.push_title, body: campaign.push_body };
  return pool[dayIndex % pool.length]!;
}

export function isRecurrenceDay(days: number[] | null | undefined, isoWeekday: number): boolean {
  return !days?.length || days.includes(isoWeekday);
}

export function dedupeKeyFor(campaignId: string, userId: string, localDate: string): string {
  return `${campaignId}:${userId}:${localDate}`;
}

export interface RecurringDecisionInput {
  campaign: RecurringCampaign;
  user: SegmentTarget;
  clock: LocalClock;
  /** Bu kampanyanin son 2 gunde yazdigi dedupe_key'ler. */
  claimed: Set<string>;
  sendTimes: Map<string, number[]>;
  config: ThrottleConfig;
  nowMs: number;
}

/** Gonderim oncesi tum guard'lar, oncelik sirasiyla. null = gonder. */
export function decideRecurringSkip(input: RecurringDecisionInput): RecurringSkip | null {
  const { campaign, user, clock, claimed, sendTimes, config, nowMs } = input;
  if (!isRecurrenceDay(campaign.recurrence_days, clock.isoWeekday)) return "not_day";
  if (clock.minuteOfDay >= campaign.window_end_hour * 60) return "after_window";
  if (clock.minuteOfDay < sendMinuteFor(campaign.id, clock.date, campaign.window_start_hour, campaign.window_end_hour)) return "before_slot";
  if (claimed.has(dedupeKeyFor(campaign.id, user.id, clock.date))) return "already_sent";
  const throttled = throttleReason(user.id, sendTimes, config, nowMs);
  if (throttled) return throttled;
  if (user.notification_preferences?.campaigns === false) return "pref_off";
  return null;
}

// ── gonderici ─────────────────────────────────────────────────────────────────

class CampaignRecurringService {
  async dispatch(now: Date = new Date()): Promise<RecurringDispatchResult> {
    const result = emptyResult();
    if (!isFcmAvailable()) {
      console.warn("[CampaignRecurring] FCM not configured — recurring campaigns skipped");
      return result;
    }
    const { data, error } = await supabase
      .from("campaigns")
      .select(CAMPAIGN_COLUMNS)
      .eq("status", "scheduled")
      .neq("recurrence", "none");
    if (error) throw error;
    const campaigns = (data ?? []) as RecurringCampaign[];
    if (!campaigns.length) return result;

    const nowMs = now.getTime();
    const { config } = await loadEngineConfig();
    const sendTimes = sendTimesByUser(await loadSendHistory(nowMs, 7));

    for (const campaign of campaigns) {
      result.campaigns++;
      try {
        await this.dispatchOne(campaign, now, config, sendTimes, result);
      } catch (err) {
        console.error(`[CampaignRecurring] ${campaign.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
    if (result.sent || result.failed) {
      console.log(`[CampaignRecurring] campaigns=${result.campaigns} sent=${result.sent} failed=${result.failed} skipped=${JSON.stringify(result.skipped)}`);
    }
    return result;
  }

  private async dispatchOne(
    campaign: RecurringCampaign,
    now: Date,
    config: ThrottleConfig,
    sendTimes: Map<string, number[]>,
    result: RecurringDispatchResult,
  ): Promise<void> {
    const nowMs = now.getTime();
    const targets = (await segmentService.listSegmentTargets(campaign.segment)).filter(isEligibleUser);
    const { error: targetedErr } = await supabase.from("campaign_stats").update({ total_targeted: targets.length }).eq("campaign_id", campaign.id);
    if (targetedErr) console.warn(`[CampaignRecurring] total_targeted yazilamadi (${campaign.id}):`, targetedErr.message);

    const claimed = await this.claimedKeysSince(campaign.id, nowMs - CLAIM_LOOKBACK_MS);

    for (const user of targets) {
      const clock = localClock(now, utcOffsetHours(user));
      const skip = decideRecurringSkip({ campaign, user, clock, claimed, sendTimes, config, nowMs });
      if (skip) { result.skipped[skip]++; continue; }

      const outcome = await this.sendToUser(campaign, user, clock, now);
      if (outcome === "claimed_elsewhere") { result.skipped.claimed_elsewhere++; continue; }
      if (outcome === "failed") { result.failed++; continue; }
      // Ayni tikte ikinci bir kampanya bu kullaniciya tavani asarak gitmesin.
      sendTimes.set(user.id, [...(sendTimes.get(user.id) ?? []), nowMs]);
      result.sent++;
    }
  }

  /** Claim (dedupe_key) → FCM → delivered + sayaclar. Tek kullanicinin hatasi kampanyayi durdurmaz. */
  private async sendToUser(campaign: RecurringCampaign, user: SegmentTarget, clock: LocalClock, now: Date): Promise<"sent" | "failed" | "claimed_elsewhere"> {
    const { error: claimErr } = await supabase.from("campaign_events").insert({
      campaign_id: campaign.id,
      user_id: user.id,
      event: "sent",
      dedupe_key: dedupeKeyFor(campaign.id, user.id, clock.date),
      created_at: now.toISOString(),
    });
    if (claimErr) {
      if (claimErr.code === PG_UNIQUE_VIOLATION) return "claimed_elsewhere";
      console.error(`[CampaignRecurring] claim failed for ${user.id}:`, claimErr.message);
      return "failed";
    }

    const variant = variantFor(campaign, clock.dayIndex, user.locale);
    let sent = false;
    try {
      sent = await NotificationService.sendPush(user.id, "campaign", { body: variant.body }, undefined, {
        title: variant.title,
        imageUrl: campaign.image_url ?? undefined,
        actionUrl: campaign.action_url ?? undefined,
        actionLabel: campaign.action_label ?? undefined,
        campaignId: campaign.id,
      });
    } catch (err) {
      console.error(`[CampaignRecurring] send failed for ${user.id}:`, err instanceof Error ? err.message : err);
    }
    await this.bumpStat(campaign.id, "total_sent");
    if (!sent) return "failed";

    const { error: deliveredErr } = await supabase
      .from("campaign_events")
      .insert({ campaign_id: campaign.id, user_id: user.id, event: "delivered", created_at: now.toISOString() });
    if (deliveredErr) console.warn(`[CampaignRecurring] delivered yazilamadi (${campaign.id}/${user.id}):`, deliveredErr.message);
    await this.bumpStat(campaign.id, "total_delivered");
    return "sent";
  }

  private async bumpStat(campaignId: string, field: "total_sent" | "total_delivered"): Promise<void> {
    const { error } = await supabase.rpc("increment_campaign_stat", { p_campaign_id: campaignId, p_field: field });
    if (error) console.warn(`[CampaignRecurring] ${field} artirilamadi (${campaignId}):`, error.message);
  }

  private async claimedKeysSince(campaignId: string, sinceMs: number): Promise<Set<string>> {
    const rows = await fetchAll<{ dedupe_key: string | null }>((from, to) =>
      supabase
        .from("campaign_events")
        .select("dedupe_key")
        .eq("campaign_id", campaignId)
        .eq("event", "sent")
        .gte("created_at", new Date(sinceMs).toISOString())
        .order("id")
        .range(from, to),
    );
    return new Set(rows.map((r) => r.dedupe_key).filter((k): k is string => typeof k === "string"));
  }
}

export const campaignRecurringService = new CampaignRecurringService();
