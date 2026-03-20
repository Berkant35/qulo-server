import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import { hashPassword, comparePassword, hashToken, generateToken, normalizeEmail, getRefreshTokenExpiry } from "../utils/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../utils/email.js";
import type { RegisterInput, LoginInput } from "../validators/auth.validator.js";
import { userLanguageService } from "./user-language.service.js";
import { referralService } from "./referral.service.js";
import { assertUuid } from "../utils/validation.js";

export class AuthService {
  async register(data: RegisterInput) {
    const email = normalizeEmail(data.email);

    // Check if email already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id, is_deleted")
      .eq("email", email)
      .maybeSingle();

    if (existing && !existing.is_deleted) {
      throw Errors.EMAIL_ALREADY_EXISTS();
    }

    // If a soft-deleted account exists with this email, hard-delete it so the user can re-register
    if (existing?.is_deleted) {
      await this.hardDeleteUser(existing.id);
    }

    const passwordHash = await hashPassword(data.password);
    const verifyToken = generateToken();
    const verifyTokenHash = hashToken(verifyToken);
    const referralCode = await referralService.generateUniqueCode();

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email,
        password_hash: passwordHash,
        name: data.name,
        surname: data.surname,
        age: data.age,
        gender: data.gender,
        locale: data.locale,
        verify_token: verifyTokenHash,
        email_verified: false,
        referral_code: referralCode,
        ...(data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : {}),
      })
      .select("id, email")
      .single();

    if (error || !user) {
      console.error("[register] Insert user failed:", error?.message, error?.code);
      throw Errors.SERVER_ERROR();
    }

    // Apply referral code if provided (don't block registration on failure)
    if (data.referral_code) {
      try {
        await referralService.applyReferralCode(user.id, data.referral_code);
      } catch (err) {
        console.error("[auth] Failed to apply referral code:", err);
      }
    }

    // Auto-add user's locale to user_languages
    await userLanguageService.addLanguage(user.id, (data.locale || 'tr') as import('../constants/locales.js').SupportedLocale);

    // Create Supabase Auth user via signUp — triggers verification email
    supabase.auth
      .signUp({
        email,
        password: data.password,
      })
      .then(({ error: authErr }) => {
        if (authErr) {
          console.error("[auth] Supabase Auth signUp failed:", authErr.message);
        } else {
          console.log(`[auth] Supabase Auth verification email sent to ${data.email}`);
        }
      })
      .catch((err) => {
        console.error("[auth] Supabase Auth signUp error:", err);
      });

    return { userId: user.id, email: user.email };
  }

  async verifyEmail(token: string) {
    const tokenHash = hashToken(token);

    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("verify_token", tokenHash)
      .eq("email_verified", false)
      .maybeSingle();

    if (error || !user) {
      throw Errors.INVALID_TOKEN();
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ email_verified: true, verify_token: null })
      .eq("id", user.id);

    if (updateError) {
      throw Errors.SERVER_ERROR();
    }

    return { userId: user.id };
  }

  async login(rawEmail: string, password: string) {
    const email = normalizeEmail(rawEmail);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_hash, email_verified, is_deleted")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      throw Errors.INVALID_CREDENTIALS();
    }

    if (user.is_deleted) {
      throw Errors.INVALID_CREDENTIALS();
    }

    // Check password first — avoid RPC call for wrong passwords
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      throw Errors.INVALID_CREDENTIALS();
    }

    // Sync email verification from Supabase Auth via RPC
    if (!user.email_verified) {
      try {
        const { data: isVerified, error: rpcError } = await supabase.rpc(
          "is_auth_email_verified",
          { user_email: email },
        );

        if (!rpcError && isVerified) {
          await supabase
            .from("users")
            .update({ email_verified: true })
            .eq("id", user.id);
          user.email_verified = true;
        }
      } catch (err) {
        console.error("[auth] Failed to check Supabase Auth verification:", err);
      }
    }

    if (!user.email_verified) {
      throw Errors.EMAIL_NOT_VERIFIED();
    }

    const payload = { userId: user.id, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const refreshTokenHash = hashToken(refreshToken);

    // Store refresh token + update last_seen in parallel
    await Promise.all([
      supabase.from("refresh_tokens").insert({
        user_id: user.id,
        token_hash: refreshTokenHash,
        expires_at: getRefreshTokenExpiry(),
      }),
      supabase
        .from("users")
        .update({ last_seen_at: new Date().toISOString(), is_online: true })
        .eq("id", user.id),
    ]);

    return { accessToken, refreshToken, userId: user.id };
  }

  async refresh(refreshToken: string) {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Errors.INVALID_TOKEN();
    }

    const oldHash = hashToken(refreshToken);

    // Find and delete the old refresh token
    const { data: storedToken, error } = await supabase
      .from("refresh_tokens")
      .select("id, user_id")
      .eq("token_hash", oldHash)
      .maybeSingle();

    if (error || !storedToken) {
      throw Errors.INVALID_TOKEN();
    }

    // Create new tokens
    const newPayload = { userId: payload.userId, email: payload.email };
    const newAccessToken = signAccessToken(newPayload);
    const newRefreshToken = signRefreshToken(newPayload);
    const newRefreshTokenHash = hashToken(newRefreshToken);

    // Insert new token first, then delete old — if insert fails, old token stays valid
    await supabase.from("refresh_tokens").insert({
      user_id: payload.userId,
      token_hash: newRefreshTokenHash,
      expires_at: getRefreshTokenExpiry(),
    });
    await supabase.from("refresh_tokens").delete().eq("id", storedToken.id);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await supabase
        .from("refresh_tokens")
        .delete()
        .eq("token_hash", tokenHash);
    }

    await supabase
      .from("users")
      .update({ is_online: false })
      .eq("id", userId);
  }

  async forgotPassword(rawEmail: string) {
    const email = normalizeEmail(rawEmail);

    const { data: user } = await supabase
      .from("users")
      .select("id, locale")
      .eq("email", email)
      .maybeSingle();

    // Don't reveal whether email exists
    if (!user) return;

    const token = generateToken();
    const tokenHash = hashToken(token);

    await supabase
      .from("users")
      .update({ verify_token: tokenHash })
      .eq("id", user.id);

    sendPasswordResetEmail(email, token, user.locale).catch((err) => {
      console.error("[auth] Failed to send password reset email:", err);
    });
  }

  /**
   * Hard-delete a soft-deleted user and all related data so the email can be re-registered.
   */
  private async hardDeleteUser(userId: string) {
    assertUuid(userId, 'userId');
    // Delete from child tables first (order matters for FK constraints)
    // Delete user's quiz sessions first, then answers cascade via FK
    // Delete deepest children first to avoid FK violations
    const { data: sessions } = await supabase
      .from("quiz_sessions")
      .select("id")
      .or(`solver_id.eq.${userId},target_id.eq.${userId}`);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id);
      // Delete quiz_answers that belong to these sessions
      for (const sid of sessionIds) {
        await supabase.from("quiz_answers").delete().eq("session_id", sid);
      }
      // Now delete the sessions themselves
      for (const sid of sessionIds) {
        await supabase.from("quiz_sessions").delete().eq("id", sid);
      }
    }

    const childTables: { table: string; column: string }[] = [
      { table: "campaign_events", column: "user_id" },
      { table: "notifications", column: "user_id" },
      { table: "message_reactions", column: "user_id" },
      { table: "messages", column: "sender_id" },
      { table: "chat_questions", column: "sender_id" },
      { table: "media_requests", column: "requester_id" },
      { table: "matches", column: "user1_id" },
      { table: "matches", column: "user2_id" },
      { table: "swipes", column: "swiper_id" },
      { table: "swipes", column: "target_id" },
      { table: "diamond_transactions", column: "user_id" },
      { table: "power_purchase_transactions", column: "user_id" },
      { table: "user_power_inventory", column: "user_id" },
      { table: "iap_transactions", column: "user_id" },
      { table: "user_subscriptions", column: "user_id" },
      { table: "questions", column: "user_id" },
      { table: "reports", column: "reporter_id" },
      { table: "reports", column: "reported_id" },
      { table: "referrals", column: "referrer_id" },
      { table: "referrals", column: "referee_id" },
      { table: "user_languages", column: "user_id" },
      { table: "user_details", column: "user_id" },
      { table: "refresh_tokens", column: "user_id" },
    ];

    for (const { table, column } of childTables) {
      const { error } = await supabase.from(table).delete().eq(column, userId);
      if (error) {
        // Table may not exist yet — log and continue
        console.warn(`[hardDelete] Failed to clean ${table}.${column}:`, error.message);
      }
    }

    // Delete photos from storage
    const { data: files } = await supabase.storage.from("photos").list(userId);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${userId}/${f.name}`);
      await supabase.storage.from("photos").remove(paths);
    }

    // Finally delete the user row
    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) {
      console.error("[hardDelete] Failed to delete user row:", error.message);
      throw Errors.SERVER_ERROR();
    }

    console.log(`[hardDelete] User ${userId} fully purged`);
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = hashToken(token);

    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("verify_token", tokenHash)
      .maybeSingle();

    if (error || !user) {
      throw Errors.INVALID_TOKEN();
    }

    const passwordHash = await hashPassword(password);

    await supabase
      .from("users")
      .update({ password_hash: passwordHash, verify_token: null })
      .eq("id", user.id);

    // Delete all refresh tokens for this user
    await supabase
      .from("refresh_tokens")
      .delete()
      .eq("user_id", user.id);

    return { userId: user.id };
  }
}

export const authService = new AuthService();
