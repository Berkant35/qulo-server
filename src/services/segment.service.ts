import { supabase } from "../config/supabase.js";
import type { SegmentInput } from "../validators/segment.validator.js";
import { fetchAll } from "./notification-engine/context.js";

export interface SegmentUser {
  /** Opsiyonel: page-message tarafi bu kolonu cekmiyor; locales filtresi olmayan segmentte gerekmez. */
  locale?: string | null;
  gender: string | null;
  age: number | null;
  city: string | null;
  subscription_plan: string | null;
  last_seen_at: string | null;
  profile_completion: number | null;
  created_at: string | null;
  question_count: number | null;
  green_diamonds: number | null;
}

const PREMIUM_PLANS = new Set(["plus", "premium"]);

/** Kampanya gonderiminin ihtiyac duydugu kullanici alanlari: uygunluk (test/seed/ban/token) + yerel saat + tercih. */
export interface SegmentTarget {
  id: string;
  push_token: string | null;
  locale: string | null;
  lng: number | null;
  is_deleted: boolean | null;
  is_banned: boolean | null;
  is_test_account: boolean | null;
  is_seed_profile: boolean | null;
  notification_preferences: Record<string, boolean> | null;
}

const SEGMENT_TARGET_COLUMNS =
  "id, push_token, locale, lng, is_deleted, is_banned, is_test_account, is_seed_profile, notification_preferences";

class SegmentService {
  // ── SQL yön: segment → eşleşen user listesi (campaign push + admin preview) ──
  /** @internal — yalnızca campaign.service ve segment.service içinden çağrılmalı. */
  buildSegmentQuery(segment: SegmentInput, opts: { count?: boolean } = { count: true }) {
    // Push token'i olmayan kullanici kampanya alamaz: sayim da liste de onu haric tutar.
    let query = supabase
      .from("users")
      .select(SEGMENT_TARGET_COLUMNS, opts.count === false ? undefined : { count: "exact" })
      .eq("is_deleted", false)
      .not("push_token", "is", null);

    if (segment.gender) query = query.eq("gender", segment.gender);
    if (segment.age_min !== undefined) query = query.gte("age", segment.age_min);
    if (segment.age_max !== undefined) query = query.lte("age", segment.age_max);
    if (segment.cities?.length) query = query.in("city", segment.cities);
    if (segment.subscription_plan) query = query.eq("subscription_plan", segment.subscription_plan);
    if (segment.last_active_days !== undefined) {
      const since = new Date();
      since.setDate(since.getDate() - segment.last_active_days);
      query = query.gte("last_seen_at", since.toISOString());
    }
    if (segment.profile_completion_min !== undefined) query = query.gte("profile_completion", segment.profile_completion_min);
    if (segment.profile_completion_max !== undefined) query = query.lte("profile_completion", segment.profile_completion_max);
    if (segment.registered_after) query = query.gte("created_at", segment.registered_after);
    if (segment.question_count_max !== undefined) query = query.lte("question_count", segment.question_count_max);
    if (segment.question_count_min !== undefined) query = query.gte("question_count", segment.question_count_min);
    if (segment.green_diamonds_max !== undefined) query = query.lte("green_diamonds", segment.green_diamonds_max);
    if (segment.is_premium === true) query = query.in("subscription_plan", ["plus", "premium"]);
    if (segment.is_premium === false) query = query.eq("subscription_plan", "free");
    if (segment.locales?.length) query = query.in("locale", segment.locales);

    return query;
  }

  /**
   * Segmentteki TUM hedefler — sayfali (PostgREST max-rows 1000 sessizce kirpar; bu tuzaga
   * discover'da dort kez dusuldu). Uygunluk (test/seed/ban) suzgeci cagiranda (isEligibleUser).
   */
  listSegmentTargets(segment: SegmentInput): Promise<SegmentTarget[]> {
    return fetchAll<SegmentTarget>((from, to) =>
      this.buildSegmentQuery(segment, { count: false }).order("id").range(from, to),
    );
  }

  async previewSegmentCount(segment: SegmentInput): Promise<number> {
    const { count, error } = await this.buildSegmentQuery(segment);
    if (error) throw error;
    return count ?? 0;
  }

  // ── In-memory yön: bu user verilen segment'e uyuyor mu? (page-message fetch) ──
  matchesSegment(user: SegmentUser, segment: SegmentInput | null): boolean {
    if (!segment) return true;
    if (segment.gender && user.gender !== segment.gender) return false;
    if (segment.age_min !== undefined && (user.age ?? -1) < segment.age_min) return false;
    if (segment.age_max !== undefined && (user.age ?? 999) > segment.age_max) return false;
    if (segment.cities?.length && !(user.city && segment.cities.includes(user.city))) return false;
    if (segment.subscription_plan && user.subscription_plan !== segment.subscription_plan) return false;
    if (segment.last_active_days !== undefined) {
      const since = Date.now() - segment.last_active_days * 86_400_000;
      if (!user.last_seen_at || Date.parse(user.last_seen_at) < since) return false;
    }
    if (segment.profile_completion_min !== undefined) {
      if (user.profile_completion == null) return false;
      if (user.profile_completion < segment.profile_completion_min) return false;
    }
    if (segment.profile_completion_max !== undefined) {
      if (user.profile_completion == null) return false;
      if (user.profile_completion > segment.profile_completion_max) return false;
    }
    if (segment.registered_after && (!user.created_at || Date.parse(user.created_at) < Date.parse(segment.registered_after))) return false;
    if (segment.question_count_max !== undefined && (user.question_count ?? 0) > segment.question_count_max) return false;
    if (segment.question_count_min !== undefined && (user.question_count ?? 0) < segment.question_count_min) return false;
    if (segment.green_diamonds_max !== undefined && (user.green_diamonds ?? 0) > segment.green_diamonds_max) return false;
    if (segment.is_premium !== undefined) {
      const premium = PREMIUM_PLANS.has(user.subscription_plan ?? "free");
      if (segment.is_premium !== premium) return false;
    }
    if (segment.locales?.length && !(user.locale && segment.locales.includes(user.locale))) return false;
    return true;
  }
}

export const segmentService = new SegmentService();
