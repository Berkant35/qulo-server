import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { Errors } from "../utils/errors.js";
import type { UpdateProfileInput, UpdateDetailsInput } from "../validators/user.validator.js";

export class UserService {
  async getMe(userId: string) {
    const { data: user, error } = await supabase
      .from("users")
      .select(
        "id, email, name, surname, bio, age, gender, gender_pref, match_radius_km, age_pref_min, age_pref_max, city, country, locale, lat, lng, photos, profile_completion, green_diamonds, purple_diamonds, is_online, last_seen_at, push_token, email_verified, passport_city, passport_lat, passport_lng, boost_until, like_received_count, times_shown_count, badge_rewards_claimed, subscription_plan, subscription_expires_at, daily_swipes_used, daily_swipes_reset_at, daily_undos_used, created_at",
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
        "id, email, name, surname, bio, age, gender, gender_pref, match_radius_km, age_pref_min, age_pref_max, city, country, locale, lat, lng, photos, profile_completion, purple_diamonds, green_diamonds, is_online, last_seen_at, email_verified, created_at",
      )
      .maybeSingle();

    if (error) {
      console.error("[updateProfile] Supabase error:", error);
      throw Errors.SERVER_ERROR();
    }
    if (!user) {
      throw Errors.USER_NOT_FOUND();
    }

    await this.recalculateProfileCompletion(userId);

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

    await this.recalculateProfileCompletion(userId);

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

    await this.recalculateProfileCompletion(userId);
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

    await this.recalculateProfileCompletion(userId);

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
      throw new (await import("../utils/errors.js")).AppError("INVALID_PHOTO_INDEX", 400, "Invalid photo index");
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

    await this.recalculateProfileCompletion(userId);

    return { photos };
  }

  async boost(userId: string) {
    // Spend 30 green diamonds
    await diamondService.spendGreen(userId, 30, "BOOST");

    const boostUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("users")
      .update({ boost_until: boostUntil })
      .eq("id", userId);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return { boost_until: boostUntil };
  }

  private async recalculateProfileCompletion(userId: string) {
    const { data: user } = await supabase
      .from("users")
      .select("name, surname, bio, city, lat, lng, photos")
      .eq("id", userId)
      .single();

    if (!user) return;

    const { data: details } = await supabase
      .from("user_details")
      .select("height, weight, zodiac, job, school, smoking, alcohol, pets, music_type, personality")
      .eq("user_id", userId)
      .maybeSingle();

    let score = 0;
    const total = 14; // total checkable fields

    // User fields (7 checks)
    if (user.name) score++;
    if (user.surname) score++;
    if (user.bio) score++;
    if (user.city) score++;
    if (user.lat != null && user.lng != null) score++;
    const photos: string[] = user.photos ?? [];
    if (photos.length >= 1) score++;
    if (photos.length >= 3) score++;

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

    const completion = Math.round((score / total) * 100);

    await supabase
      .from("users")
      .update({ profile_completion: completion })
      .eq("id", userId);
  }
}

export const userService = new UserService();
