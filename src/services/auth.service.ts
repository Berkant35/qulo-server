import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import { hashPassword, comparePassword, hashToken, generateToken, normalizeEmail, getRefreshTokenExpiry } from "../utils/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../utils/email.js";
import type { RegisterInput, LoginInput } from "../validators/auth.validator.js";
import { userLanguageService } from "./user-language.service.js";
import { referralService } from "./referral.service.js";

export class AuthService {
  async register(data: RegisterInput) {
    const email = normalizeEmail(data.email);

    // Check if email already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      throw Errors.EMAIL_ALREADY_EXISTS();
    }

    const passwordHash = await hashPassword(data.password);
    const verifyToken = generateToken();
    const verifyTokenHash = hashToken(verifyToken);

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
        ...(data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : {}),
      })
      .select("id, email")
      .single();

    if (error || !user) {
      throw Errors.SERVER_ERROR();
    }

    // Generate unique referral code for the new user
    try {
      const referralCode = await referralService.generateUniqueCode();
      await supabase
        .from("users")
        .update({ referral_code: referralCode })
        .eq("id", user.id);
    } catch (err) {
      console.error("[auth] Failed to generate referral code:", err);
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
