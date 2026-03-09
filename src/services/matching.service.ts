import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { haversineDistance } from "../utils/math.js";
import { assertUuid } from "../utils/validation.js";
import { scoringService } from "./scoring.service.js";
import { subscriptionService } from "./subscription.service.js";
import { userLanguageService } from "./user-language.service.js";

const PAGE_SIZE = 10;

interface CandidateRow {
  id: string;
  name: string;
  bio: string | null;
  age: number;
  gender: string;
  city: string | null;
  lat: number;
  lng: number;
  photos: string[] | null;
  profile_completion: number;
  green_diamonds: number;
  like_received_count: number;
  times_shown_count: number;
  last_seen_at: string;
  boost_until: string | null;
}

interface QuestionInfo {
  count: number;
  categories: string[];
  avg_difficulty: string;
  languages: string[];
}

interface ProfileCard {
  user_id: string;
  name: string;
  age: number;
  city: string | null;
  bio: string | null;
  photos: string[] | null;
  distance_km: number;
  question_count: number;
  profile_completion: number;
  is_boosted: boolean;
  question_info: QuestionInfo;
}

export class MatchingService {
  /**
   * Discover candidates for a user.
   */
  async discover(userId: string, page = 1): Promise<{ cards: ProfileCard[]; page: number; has_more: boolean }> {
    // 1. Get current user + already-swiped IDs in parallel
    const [userResult, swipedResult] = await Promise.all([
      supabase
        .from("users")
        .select(
          "id, gender_pref, age_pref_min, age_pref_max, match_radius_km, lat, lng, passport_lat, passport_lng",
        )
        .eq("id", userId)
        .eq("is_deleted", false)
        .maybeSingle(),
      supabase
        .from("swipes")
        .select("target_id")
        .eq("swiper_id", userId),
    ]);

    const { data: user, error: userError } = userResult;
    if (userError || !user) throw Errors.USER_NOT_FOUND();

    // Get user's language preferences for filtering
    const userLanguages = await userLanguageService.getUserLanguages(userId);

    // Determine location (passport overrides real)
    const myLat = (user.passport_lat as number | null) ?? user.lat;
    const myLng = (user.passport_lng as number | null) ?? user.lng;

    if (myLat == null || myLng == null) {
      throw Errors.PROFILE_INCOMPLETE();
    }

    const maxRadius: number = user.match_radius_km ?? 100;

    const { data: swipedRows } = swipedResult;

    const excludedIds = new Set<string>([userId]);
    if (swipedRows) {
      for (const row of swipedRows) {
        excludedIds.add(row.target_id as string);
      }
    }

    // 3. Query candidates
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from("users")
      .select(
        "id, name, bio, age, gender, city, lat, lng, photos, profile_completion, green_diamonds, like_received_count, times_shown_count, last_seen_at, boost_until",
      )
      .eq("is_deleted", false)
      .eq("email_verified", true)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .gte("last_seen_at", sevenDaysAgo)
      .limit(50);

    // Age filter
    if (user.age_pref_min != null) {
      query = query.gte("age", user.age_pref_min);
    }
    if (user.age_pref_max != null) {
      query = query.lte("age", user.age_pref_max);
    }

    // Gender pref filter
    if (user.gender_pref && user.gender_pref !== "BOTH") {
      query = query.eq("gender", user.gender_pref);
    }

    const { data: candidates, error: candError } = await query;

    if (candError) {
      console.error("[matching] Candidate query error:", candError);
      throw Errors.SERVER_ERROR();
    }

    if (!candidates || candidates.length === 0) {
      return { cards: [], page, has_more: false };
    }

    // 4. Filter out excluded + distance
    const filtered: (CandidateRow & { distance_km: number })[] = [];
    for (const c of candidates as CandidateRow[]) {
      if (excludedIds.has(c.id)) continue;

      const dist = haversineDistance(myLat, myLng, c.lat, c.lng);
      if (dist > maxRadius) continue;

      filtered.push({ ...c, distance_km: Math.round(dist * 10) / 10 });
    }

    // 5. Batch fetch question counts for candidates
    const candidateIds = filtered.map((c) => c.id);
    const questionCountMap = new Map<string, number>();

    if (candidateIds.length > 0) {
      const { data: qCounts } = await supabase
        .from("questions")
        .select("user_id")
        .in("user_id", candidateIds);

      if (qCounts) {
        for (const row of qCounts) {
          const uid = row.user_id as string;
          questionCountMap.set(uid, (questionCountMap.get(uid) ?? 0) + 1);
        }
      }
    }

    // 5.2 — Enrich candidates with question info (category + difficulty)
    const questionInfoMap = new Map<string, QuestionInfo>();

    if (candidateIds.length > 0) {
      const { data: questionStats } = await supabase
        .from('questions')
        .select('user_id, category, stats_correct, stats_wrong, locale')
        .in('user_id', candidateIds);

      for (const cId of candidateIds) {
        const userQuestions = (questionStats ?? []).filter((q: any) => q.user_id === cId);
        const totalAttempts = userQuestions.reduce((s: number, q: any) => s + q.stats_correct + q.stats_wrong, 0);
        const totalCorrect = userQuestions.reduce((s: number, q: any) => s + q.stats_correct, 0);
        const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 50;

        let difficulty = 'unranked';
        if (totalAttempts >= 10) {
          if (successRate > 70) difficulty = 'easy';
          else if (successRate > 40) difficulty = 'medium';
          else if (successRate > 20) difficulty = 'hard';
          else difficulty = 'legendary';
        }

        const categories = [...new Set(userQuestions.map((q: any) => q.category).filter(Boolean))] as string[];
        const languages = [...new Set(userQuestions.map((q: any) => q.locale || 'tr'))] as string[];

        questionInfoMap.set(cId, {
          count: userQuestions.length,
          categories,
          avg_difficulty: difficulty,
          languages,
        });
      }
    }

    // 5.5 — Filter out users with < 2 questions (not discoverable)
    let discoverableFiltered = filtered.filter((c) => {
      const qCount = questionCountMap.get(c.id) ?? 0;
      return qCount >= 2;
    });

    // 5.6 — Language filter: candidate must have 2+ questions in user's languages
    if (userLanguages.length > 0) {
      const langCandidateIds = discoverableFiltered.map((c) => c.id);
      if (langCandidateIds.length > 0) {
        const { data: candidateQuestionData } = await supabase
          .from('questions')
          .select('user_id, locale')
          .in('user_id', langCandidateIds);

        const questionLocalesByUser = new Map<string, string[]>();
        for (const q of candidateQuestionData || []) {
          const locales = questionLocalesByUser.get(q.user_id as string) || [];
          locales.push((q.locale as string) || 'tr');
          questionLocalesByUser.set(q.user_id as string, locales);
        }

        discoverableFiltered = discoverableFiltered.filter((c) => {
          const qLocales = questionLocalesByUser.get(c.id) || [];
          const matchingCount = qLocales.filter((l: string) => userLanguages.includes(l)).length;
          return matchingCount >= 2;
        });
      }
    }

    // 6. Score each candidate
    const now = new Date();
    const isBoostActive = (boostUntil: string | null): boolean =>
      boostUntil != null && new Date(boostUntil) > now;

    const scored = discoverableFiltered.map((c) => {
      const photoCount = c.photos?.length ?? 0;
      const qCount = questionCountMap.get(c.id) ?? 0;

      const desirability = scoringService.desirabilityScore(c.like_received_count, c.times_shown_count);
      const engagement = scoringService.engagementScore(c.green_diamonds, 0); // quizCompletionRate not available yet
      const recency = scoringService.recencyScore(c.last_seen_at);
      const distance = scoringService.distanceScore(c.distance_km, maxRadius);
      const profile = scoringService.profileScore(c.profile_completion, photoCount, !!c.bio);

      const score = scoringService.totalScore({
        desirability,
        engagement,
        recency,
        distance,
        profile,
        boostActive: isBoostActive(c.boost_until),
      });

      return { candidate: c, score, questionCount: qCount };
    });

    // 7. Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // 8. Paginate
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = scored.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < scored.length;

    // 9. Increment times_shown_count for returned users
    if (pageItems.length > 0) {
      const shownIds = pageItems.map((s) => s.candidate.id);
      await supabase.rpc("increment_times_shown", { user_ids: shownIds });
    }

    // 10. Build profile cards
    const cards: ProfileCard[] = pageItems.map((s) => ({
      user_id: s.candidate.id,
      name: s.candidate.name,
      age: s.candidate.age,
      city: s.candidate.city,
      bio: s.candidate.bio,
      photos: s.candidate.photos,
      distance_km: s.candidate.distance_km,
      question_count: s.questionCount,
      profile_completion: s.candidate.profile_completion,
      is_boosted: isBoostActive(s.candidate.boost_until),
      question_info: questionInfoMap.get(s.candidate.id) ?? { count: 0, categories: [], avg_difficulty: 'unranked', languages: [] },
    }));

    return { cards, page, has_more: hasMore };
  }

  /**
   * Swipe on a user (LIKE or REJECT).
   */
  async swipe(swiperId: string, targetId: string, action: "LIKE" | "REJECT") {
    // Self-swipe check
    if (swiperId === targetId) {
      throw Errors.SELF_SWIPE();
    }

    // Daily swipe limit check + increment
    await subscriptionService.incrementDailySwipes(swiperId);

    // If LIKE, check target has >= 2 questions
    if (action === "LIKE") {
      const { count, error: qError } = await supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", targetId);

      if (qError) throw Errors.SERVER_ERROR();
      if ((count ?? 0) < 2) throw Errors.NO_QUESTIONS();
    }

    // Insert swipe
    const { error: swipeError } = await supabase
      .from("swipes")
      .insert({ swiper_id: swiperId, target_id: targetId, action });

    if (swipeError) {
      // Unique constraint violation
      if (swipeError.code === "23505") {
        throw Errors.ALREADY_SWIPED();
      }
      console.error("[matching] Swipe insert error:", swipeError);
      throw Errors.SERVER_ERROR();
    }

    // If LIKE, increment like_received_count
    if (action === "LIKE") {
      await supabase.rpc("increment_like_received", { target_user_id: targetId });

      // Check for mutual like (match)
      const { data: mutual } = await supabase
        .from("swipes")
        .select("id")
        .eq("swiper_id", targetId)
        .eq("target_id", swiperId)
        .eq("action", "LIKE")
        .maybeSingle();

      if (mutual) {
        // Create match — order user IDs consistently
        const [user1, user2] = [swiperId, targetId].sort();
        const { error: matchError } = await supabase
          .from("matches")
          .insert({ user1_id: user1, user2_id: user2 });

        if (matchError && matchError.code !== "23505") {
          console.error("[matching] Match insert error:", matchError);
        }

        return { matched: true };
      }
    }

    return { matched: false };
  }

  /**
   * Get all active matches for a user.
   */
  async getMatches(userId: string) {
    assertUuid(userId, "userId");

    const { data: matches, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, matched_at")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq("is_active", true)
      .order("matched_at", { ascending: false });

    if (error) {
      console.error("[matching] Get matches error:", error);
      throw Errors.SERVER_ERROR();
    }

    if (!matches || matches.length === 0) return [];

    // Gather other user IDs
    const otherIds = matches.map((m) =>
      m.user1_id === userId ? (m.user2_id as string) : (m.user1_id as string),
    );

    // Fetch basic info for other users
    const { data: others } = await supabase
      .from("users")
      .select("id, name, age, city, photos, bio, is_online, last_seen_at")
      .in("id", otherIds);

    const otherMap = new Map<string, (typeof others extends (infer U)[] | null ? U : never)>();
    if (others) {
      for (const o of others) {
        otherMap.set(o.id as string, o);
      }
    }

    return matches.map((m) => {
      const otherId = m.user1_id === userId ? (m.user2_id as string) : (m.user1_id as string);
      const other = otherMap.get(otherId);
      return {
        match_id: m.id,
        matched_at: m.matched_at,
        user: other
          ? {
              user_id: other.id,
              name: other.name,
              age: other.age,
              city: other.city,
              photos: other.photos,
              bio: other.bio,
              is_online: other.is_online,
              last_seen: other.last_seen_at,
            }
          : null,
      };
    });
  }

  /**
   * Unmatch — deactivate a match.
   */
  async unmatch(userId: string, matchId: string) {
    const { data: match, error: fetchError } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active")
      .eq("id", matchId)
      .maybeSingle();

    if (fetchError || !match) {
      throw Errors.NOT_MATCHED();
    }

    // Ensure user is part of the match
    if (match.user1_id !== userId && match.user2_id !== userId) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    const { error: updateError } = await supabase
      .from("matches")
      .update({ is_active: false })
      .eq("id", matchId);

    if (updateError) {
      console.error("[matching] Unmatch error:", updateError);
      throw Errors.SERVER_ERROR();
    }

    return { message: "Unmatched successfully" };
  }
}

export const matchingService = new MatchingService();
