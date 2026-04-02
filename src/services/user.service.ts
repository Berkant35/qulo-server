import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { referralService } from "./referral.service.js";
import { economyConfigService } from "./economy-config.service.js";
import { userLanguageService } from "./user-language.service.js";
import { Errors } from "../utils/errors.js";
import { haversineDistance } from "../utils/math.js";
import type { UpdateProfileInput, UpdateDetailsInput } from "../validators/user.validator.js";

export class UserService {
  async getMe(userId: string) {
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, email, name, surname, bio, age, gender, gender_pref, match_radius_km, age_pref_min, age_pref_max, city, country, locale, lat, lng, photos, profile_completion, green_diamonds, purple_diamonds, is_online, last_seen_at, push_token, email_verified, passport_city, passport_lat, passport_lng, boost_until, like_received_count, times_shown_count, badge_rewards_claimed, preferred_languages, completion_rewards_claimed, relationship_goal, subscription_plan, subscription_expires_at, daily_swipes_used, daily_swipes_reset_at, daily_undos_used, strict_language_mode, created_at",
      )
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Fetch user_details
    const { data: details } = await supabase
      .from("user_details")
      .select("height, weight, zodiac, job, school, smoking, alcohol, pets, music_type, personality")
      .eq("user_id", userId)
      .maybeSingle();

    // Fetch question count
    const { count: questionCount } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    return {
      ...user,
      question_count: questionCount ?? 0,
      subscriptionPlan: user.subscription_plan || null,
      subscriptionExpiresAt: user.subscription_expires_at || null,
      dailySwipesUsed: user.daily_swipes_used || 0,
      dailyUndosUsed: user.daily_undos_used || 0,
      details: details ?? null,
    };
  }

  async updateProfile(userId: string, data: UpdateProfileInput) {
    const { data: user, error } = await supabase
      .from("users")
      .update(data)
      .eq("id", userId)
      .eq("is_deleted", false)
      .select(
        "id, email, name, surname, bio, age, gender, gender_pref, match_radius_km, age_pref_min, age_pref_max, city, country, locale, lat, lng, photos, profile_completion, preferred_languages, purple_diamonds, green_diamonds, is_online, last_seen_at, email_verified, strict_language_mode, created_at",
      )
      .maybeSingle();

    if (error) {
      console.error("[updateProfile] Supabase error:", error);
      throw Errors.SERVER_ERROR();
    }
    if (!user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Sync user_languages table if preferred_languages was updated
    if (data.preferred_languages && Array.isArray(data.preferred_languages)) {
      try {
        await userLanguageService.setUserLanguages(userId, data.preferred_languages);
      } catch (err) {
        console.error("[updateProfile] sync user_languages error:", err);
      }
    }

    try {
      await this.recalculateProfileCompletion(userId);
    } catch (err) {
      console.error("[updateProfile] recalculateProfileCompletion error:", err);
    }

    // Re-fetch to get updated completion
    const { data: updated } = await supabase
      .from("users")
      .select("profile_completion")
      .eq("id", userId)
      .single();

    return { ...user, profile_completion: updated?.profile_completion ?? user.profile_completion };
  }

  async updateDetails(userId: string, data: UpdateDetailsInput) {
    // Verify user exists
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (!user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Check if details row exists
    const { data: existing } = await supabase
      .from("user_details")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("user_details")
        .update(data)
        .eq("user_id", userId);

      if (error) throw Errors.SERVER_ERROR();
    } else {
      const { error } = await supabase
        .from("user_details")
        .insert({ user_id: userId, ...data });

      if (error) throw Errors.SERVER_ERROR();
    }

    try {
      await this.recalculateProfileCompletion(userId);
    } catch (err) {
      console.error("[updateDetails] recalculateProfileCompletion error:", err);
    }

    const { data: details } = await supabase
      .from("user_details")
      .select("height, weight, zodiac, job, school, smoking, alcohol, pets, music_type, personality")
      .eq("user_id", userId)
      .single();

    return details;
  }

  async updateLocation(userId: string, lat: number, lng: number, city?: string) {
    const updateData: Record<string, unknown> = { lat, lng };
    if (city) updateData.city = city;

    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .eq("is_deleted", false);

    if (error) {
      console.error("[updateLocation] Supabase error:", error);
      throw Errors.SERVER_ERROR();
    }

    try {
      await this.recalculateProfileCompletion(userId);
    } catch (err) {
      console.error("[updateLocation] recalculateProfileCompletion error:", err);
    }
  }

  async updatePushToken(userId: string, pushToken: string) {
    const { error } = await supabase
      .from("users")
      .update({ push_token: pushToken })
      .eq("id", userId)
      .eq("is_deleted", false);

    if (error) throw Errors.SERVER_ERROR();
  }

  async deleteAccount(userId: string) {
    const { error } = await supabase
      .from("users")
      .update({ is_deleted: true, is_online: false })
      .eq("id", userId);

    if (error) throw Errors.SERVER_ERROR();

    // Delete all refresh tokens
    await supabase
      .from("refresh_tokens")
      .delete()
      .eq("user_id", userId);
  }

  async uploadPhoto(userId: string, fileBuffer: Buffer, mimeType: string) {
    // Get current photos
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("photos")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (fetchError || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    const photos: string[] = user.photos ?? [];
    if (photos.length >= 6) {
      throw Errors.MAX_PHOTOS_REACHED();
    }

    const ext = mimeType === "image/png" ? "png" : "jpg";
    const fileName = `${userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("photos")
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[user] Photo upload failed:", uploadError);
      throw Errors.SERVER_ERROR();
    }

    const { data: urlData } = supabase.storage
      .from("photos")
      .getPublicUrl(fileName);

    const photoUrl = urlData.publicUrl;
    photos.push(photoUrl);

    const { error: updateError } = await supabase
      .from("users")
      .update({ photos })
      .eq("id", userId);

    if (updateError) throw Errors.SERVER_ERROR();

    try {
      await this.recalculateProfileCompletion(userId);
    } catch (err) {
      console.error("[uploadPhoto] recalculateProfileCompletion error:", err);
    }

    return { photos, url: photoUrl };
  }

  async deletePhoto(userId: string, index: number) {
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("photos")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (fetchError || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    const photos: string[] = user.photos ?? [];
    if (index < 0 || index >= photos.length) {
      throw Errors.INVALID_PHOTO_INDEX();
    }

    const photoUrl = photos[index];

    // Extract file path from URL
    const urlParts = photoUrl.split("/storage/v1/object/public/photos/");
    if (urlParts.length === 2) {
      const filePath = urlParts[1];
      await supabase.storage.from("photos").remove([filePath]);
    }

    photos.splice(index, 1);

    const { error: updateError } = await supabase
      .from("users")
      .update({ photos })
      .eq("id", userId);

    if (updateError) throw Errors.SERVER_ERROR();

    try {
      await this.recalculateProfileCompletion(userId);
    } catch (err) {
      console.error("[deletePhoto] recalculateProfileCompletion error:", err);
    }

    return { photos };
  }

  async boost(userId: string) {
    const config = await economyConfigService.getConfig();
    await diamondService.spendGreen(userId, config.core.boostCostGreen, "BOOST");

    const boostUntil = new Date(Date.now() + config.core.boostDurationMinutes * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("users")
      .update({ boost_until: boostUntil })
      .eq("id", userId);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return { boost_until: boostUntil };
  }

  async getPublicProfile(requesterId: string, targetId: string) {
    // Block check
    const { blockService } = await import("./block.service.js");
    const blocked = await blockService.isBlocked(requesterId, targetId);
    if (blocked) throw Errors.USER_NOT_FOUND();

    // Get target user
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, name, age, bio, city, country, photos, relationship_goal, is_online, last_seen_at, profile_completion, boost_until, lat, lng"
      )
      .eq("id", targetId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error || !user) throw Errors.USER_NOT_FOUND();

    // Get details (excluding weight for privacy)
    const { data: details } = await supabase
      .from("user_details")
      .select("height, zodiac, job, school, smoking, alcohol, pets, music_type, personality")
      .eq("user_id", targetId)
      .maybeSingle();

    // Check if matched (for online/last_seen visibility)
    const { data: matchData } = await supabase
      .from("matches")
      .select("id")
      .eq("is_active", true)
      .or(
        `and(user1_id.eq.${requesterId},user2_id.eq.${targetId}),and(user1_id.eq.${targetId},user2_id.eq.${requesterId})`
      )
      .limit(1);

    const isMatched = (matchData?.length ?? 0) > 0;

    // Calculate distance
    const { data: requester } = await supabase
      .from("users")
      .select("lat, lng, passport_lat, passport_lng")
      .eq("id", requesterId)
      .single();

    let distanceKm = 0;
    if (requester && user.lat && user.lng) {
      const reqLat = requester.passport_lat ?? requester.lat;
      const reqLng = requester.passport_lng ?? requester.lng;
      distanceKm = haversineDistance(reqLat, reqLng, user.lat, user.lng);
    }

    // Question info
    interface QuestionStats {
      category: string | null;
      stats_correct: number;
      stats_wrong: number;
      locale: string | null;
    }

    const { data: questions } = await supabase
      .from("questions")
      .select("category, stats_correct, stats_wrong, locale")
      .eq("user_id", targetId)
      .limit(100);

    let questionInfo = null;
    if (questions && questions.length > 0) {
      const totalAttempts = questions.reduce((s: number, q: QuestionStats) => s + q.stats_correct + q.stats_wrong, 0);
      const totalCorrect = questions.reduce((s: number, q: QuestionStats) => s + q.stats_correct, 0);
      const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 50;

      let difficulty = "unranked";
      if (totalAttempts >= 10) {
        if (successRate > 70) difficulty = "easy";
        else if (successRate > 40) difficulty = "medium";
        else if (successRate > 20) difficulty = "hard";
        else difficulty = "legendary";
      }

      questionInfo = {
        count: questions.length,
        categories: [...new Set(questions.map((q: QuestionStats) => q.category).filter(Boolean))],
        avg_difficulty: difficulty,
        languages: [...new Set(questions.map((q: QuestionStats) => q.locale || "tr"))],
      };
    }

    return {
      user_id: user.id,
      name: user.name,
      age: user.age,
      bio: user.bio,
      city: user.city,
      country: user.country,
      photos: user.photos ?? [],
      distance_km: Math.round(distanceKm * 10) / 10,
      relationship_goal: user.relationship_goal,
      is_online: isMatched ? user.is_online : null,
      last_seen: isMatched ? user.last_seen_at : null,
      profile_completion: user.profile_completion,
      is_boosted: user.boost_until ? new Date(user.boost_until) > new Date() : false,
      details: details ?? null,
      question_info: questionInfo,
    };
  }

  private async recalculateProfileCompletion(userId: string) {
    const { data: user } = await supabase
      .from("users")
      .select("name, surname, bio, city, lat, lng, photos, relationship_goal, preferred_languages, completion_rewards_claimed")
      .eq("id", userId)
      .single();

    if (!user) return;

    const { data: details } = await supabase
      .from("user_details")
      .select("height, weight, zodiac, job, school, smoking, alcohol, pets, music_type, personality")
      .eq("user_id", userId)
      .maybeSingle();

    let score = 0;
    const total = 16; // total checkable fields

    // User fields (9 checks)
    if (user.name) score++;
    if (user.surname) score++;
    if (user.bio) score++;
    if (user.city) score++;
    if (user.lat != null && user.lng != null) score++;
    const photos: string[] = user.photos ?? [];
    if (photos.length >= 1) score++;
    if (photos.length >= 3) score++;
    if (user.relationship_goal && user.relationship_goal !== 'NOT_SURE') score++;
    if (user.preferred_languages && user.preferred_languages.length > 0) score++;

    // Detail fields (7 checks)
    if (details) {
      if (details.height != null) score++;
      if (details.weight != null) score++;
      if (details.zodiac) score++;
      if (details.job) score++;
      if (details.school) score++;
      if (details.smoking) score++;
      if (details.alcohol) score++;
    }

    const newCompletion = Math.round((score / total) * 100);

    // Milestone rewards
    const milestones = [
      { threshold: 25, reward: 5 },
      { threshold: 50, reward: 15 },
      { threshold: 75, reward: 30 },
      { threshold: 100, reward: 50 },
    ];

    const claimed: Record<string, boolean> = user.completion_rewards_claimed || {};

    for (const m of milestones) {
      if (newCompletion >= m.threshold && !claimed[String(m.threshold)]) {
        try {
          await diamondService.addPurple(userId, m.reward, 'PROFILE_COMPLETION', `milestone_${m.threshold}`);
          claimed[String(m.threshold)] = true;

          if (m.threshold === 100) {
            const boostUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await supabase.from('users').update({ boost_until: boostUntil.toISOString() }).eq('id', userId);
          }
        } catch (err) {
          console.error(`[recalculateProfileCompletion] Milestone ${m.threshold} reward failed:`, err);
        }
      }
    }

    // Update both completion and rewards claimed
    await supabase
      .from("users")
      .update({
        profile_completion: newCompletion,
        completion_rewards_claimed: claimed,
      })
      .eq("id", userId);

    // Check and reward referral if profile completion >= 60%
    try {
      await referralService.checkAndReward(userId, newCompletion);
    } catch {
      // Best effort — referrals table may not exist yet
    }
  }
  private static readonly DEFAULT_NOTIFICATION_PREFERENCES = {
    messages: true,
    matches: true,
    campaigns: true,
  };

  async getNotificationPreferences(userId: string) {
    const { data, error } = await supabase
      .from('users')
      .select('notification_preferences')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw Errors.USER_NOT_FOUND();
    }

    return {
      ...UserService.DEFAULT_NOTIFICATION_PREFERENCES,
      ...(data.notification_preferences ?? {}),
    };
  }

  async updateNotificationPreferences(
    userId: string,
    input: { messages?: boolean; matches?: boolean; campaigns?: boolean },
  ) {
    const current = await this.getNotificationPreferences(userId);
    const merged = { ...current, ...input };

    const { error } = await supabase
      .from('users')
      .update({ notification_preferences: merged })
      .eq('id', userId);

    if (error) {
      throw Errors.USER_NOT_FOUND();
    }

    return merged;
  }

  async completeProfile(userId: string, data: {
    birthday: string;
    gender: string;
    lat?: number;
    lng?: number;
    name?: string;
    surname?: string;
  }) {
    const birthDate = new Date(data.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);
      if (deleteError) console.error("[completeProfile] Failed to delete underage user:", deleteError.message);
      throw Errors.UNDERAGE_USER();
    }

    if (age > 99) {
      throw Errors.VALIDATION_ERROR({ birthday: "Invalid date of birth" });
    }

    const updateData: Record<string, unknown> = { age, gender: data.gender };
    if (data.lat != null && data.lng != null) {
      updateData.lat = data.lat;
      updateData.lng = data.lng;
    }
    if (data.name) updateData.name = data.name;
    if (data.surname) updateData.surname = data.surname;

    const { error } = await supabase.from("users").update(updateData).eq("id", userId);
    if (error) {
      console.error("[completeProfile] Update failed:", error.message);
      throw Errors.SERVER_ERROR();
    }

    return { age, gender: data.gender };
  }
}

export const userService = new UserService();
