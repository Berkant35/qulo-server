import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";
import { hashPassword, comparePassword, hashToken, generateToken, normalizeEmail, getRefreshTokenExpiry } from "../utils/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../utils/email.js";
import type { RegisterInput } from "../validators/auth.validator.js";
import { resolveLocale, localeFromTag } from "../utils/locales.js";
import type { ClientMeta } from "../utils/client-meta.js";
import { userLanguageService } from "./user-language.service.js";
import { referralService } from "./referral.service.js";
import { consentService } from "./consent.service.js";
import { accountPurgeService } from "./account-purge.service.js";
import { exchangeService } from "./exchange.service.js";
import { verifyGoogleToken, verifyAppleToken, type SocialAuthPayload } from "../utils/social-auth.js";
import { issueVerifyToken } from "./email-verification.service.js";

export class AuthService {
  async register(data: RegisterInput, client: ClientMeta = {}) {
    const email = normalizeEmail(data.email);

    // Check if email already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id, is_deleted, is_banned")
      .eq("email", email)
      .maybeSingle();

    if (existing && !existing.is_deleted) {
      throw Errors.EMAIL_ALREADY_EXISTS();
    }

    // Banli hesap silinmis olsa da temizlenmez: purge ban kaydini ve sikayetleri
    // silip temiz bir hesap acardi (ban kacirma).
    if (existing?.is_banned) {
      throw Errors.ACCOUNT_BANNED();
    }

    // If a soft-deleted account exists with this email, hard-delete it so the user can re-register
    if (existing?.is_deleted) {
      await accountPurgeService.hardDeleteUser(existing.id);
    }
    const purged = existing?.is_deleted === true;

    const passwordHash = await hashPassword(data.password);
    const { token: verifyToken, hash: verifyTokenHash, expiresAt: tokenExpiresAt } = issueVerifyToken();
    const referralCode = await referralService.generateUniqueCode();
    // Uygulama dili = eslesme tercihinin ana degeri; iki alan ayni kaynaktan turer.
    const locale = resolveLocale(data.locale);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email,
        password_hash: passwordHash,
        name: data.name,
        surname: data.surname,
        age: data.age,
        gender: data.gender,
        locale,
        // Sutun satir dogarken dolu: RPC patlasa bile kullanici dilsiz kalmaz (054 DEFAULT '{}').
        preferred_languages: [locale],
        // is_test_admin sunucu-only: prod DB default'u bir donem `true`'ya drift etmisti
        // (bkz. migration 073). Insert'te acikca yazip DB default'una bagimliligi keseriz.
        is_test_admin: false,
        // Rainbow ana anahtari kapaliyken tek kapi bu bayrak; test hesaplari seed betiklerinden acilir.
        is_test_account: false,
        verify_token: verifyTokenHash,
        token_expires_at: tokenExpiresAt,
        email_verified: false,
        referral_code: referralCode,
        ...(data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : {}),
        ...(data.gender_pref
          ? { gender_pref: data.gender_pref, gender_pref_set_at: new Date().toISOString() }
          : {}),
      })
      .select("id, email")
      .single();

    if (error || !user) {
      console.error("[register] Insert user failed:", error?.message, error?.code);
      throw Errors.SERVER_ERROR();
    }

    // Record ToS + Privacy Policy consent (non-blocking)
    consentService.recordRegistrationConsents(user.id, client).catch((err) => {
      console.error("[auth] Failed to record consents:", err);
    });

    // Baslangic paketi yalniz ILK hesaba: silip ayni e-postayla yeniden kaydolan tekrar almaz —
    // aksi halde "kaydol → bedava SKIP_ALL → eslesme → sil → kaydol" dongusu sinirsiz bedava quiz olur.
    if (!purged) void exchangeService.grantStarterPack(user.id);

    // Apply referral code if provided (don't block registration on failure)
    if (data.referral_code) {
      try {
        await referralService.applyReferralCode(user.id, data.referral_code);
      } catch (err) {
        console.error("[auth] Failed to apply referral code:", err);
      }
    }

    // Tek RPC user_languages'i tamamlar (sutun zaten INSERT'te; migration 054). Fail-open:
    // consent/starter/referral ile ayni politika — aksi halde users satiri olusmus,
    // dogrulama e-postasi gitmemis, tekrar kayit 409 -> hesap kilitli kalirdi.
    try {
      await userLanguageService.setUserLanguages(user.id, [locale]);
    } catch (err) {
      console.error("[auth] Failed to sync languages:", err);
    }

    sendVerificationEmail(email, verifyToken, data.locale).catch((err) => {
      console.error('[auth] Failed to send verification email:', err instanceof Error ? err.message : err);
    });

    // "Önce içeri al": kayıt oturumu da açar — doğrulama yalnız eşleşmeye ilk yazımda istenir
    // (emailVerifiedGuard). Eski istemciler token alanlarını yok sayar, login'e gider; o da artık açık.
    const session = await this.createSession(user.id, user.email);
    return { userId: user.id, email: user.email, accessToken: session.accessToken, refreshToken: session.refreshToken, emailVerified: false };
  }

  async login(rawEmail: string, password: string) {
    const email = normalizeEmail(rawEmail);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, password_hash, email_verified, is_deleted, is_seed_profile")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      throw Errors.INVALID_CREDENTIALS();
    }

    if (user.is_deleted) {
      throw Errors.INVALID_CREDENTIALS();
    }

    // Seed (test) profilleri giriş yapamaz: e-postaları öngörülebilir (seed-tr_NNNN@qulo.seed) ve
    // doğrulanmış; şifre bilinse bile hesap kullanılamamalı. Aynı hata → varlık sızmaz.
    if (user.is_seed_profile) {
      throw Errors.INVALID_CREDENTIALS();
    }

    // Social login users cannot use email/password login
    if (!user.password_hash) {
      throw Errors.SOCIAL_LOGIN_ONLY();
    }

    // Check password first — avoid RPC call for wrong passwords
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      throw Errors.INVALID_CREDENTIALS();
    }

    // Doğrulanmamış e-posta girişi ENGELLEMEZ (2026-10-04): yeni kullanıcıların ~%25'i doğrulama
    // duvarında kayboluyordu. Kapı eşleşmeye ilk yazımda (emailVerifiedGuard); istemci bayrağı görür.
    const session = await this.createSession(user.id, user.email);
    return { ...session, userId: user.id, emailVerified: user.email_verified === true };
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
    if (!user) {
      console.log("[auth] forgotPassword: user not found");
      return;
    }

    console.log("[auth] forgotPassword: user found, generating token", { userId: user.id });

    const token = generateToken();
    const tokenHash = hashToken(token);
    const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabase
      .from("users")
      .update({ verify_token: tokenHash, token_expires_at: tokenExpiresAt })
      .eq("id", user.id);

    console.log("[auth] forgotPassword: sending reset email", { userId: user.id, locale: user.locale });

    sendPasswordResetEmail(email, token, user.locale)
      .then(() => console.log("[auth] forgotPassword: email sent successfully", { userId: user.id }))
      .catch((err) => {
        console.error("[auth] Failed to send password reset email:", err instanceof Error ? err.message : err);
      });
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = hashToken(token);

    const { data: user, error } = await supabase
      .from("users")
      .select("id, token_expires_at")
      .eq("verify_token", tokenHash)
      .maybeSingle();

    if (error || !user) {
      throw Errors.INVALID_TOKEN();
    }

    if (user.token_expires_at && new Date(user.token_expires_at) < new Date()) {
      throw Errors.TOKEN_EXPIRED();
    }

    const passwordHash = await hashPassword(password);

    const { error: updateError } = await supabase
      .from("users")
      // Sıfırlama bağlantısı e-postaya gitti: kutunun sahibi olduğu kanıtlandı → doğrulanmış say.
      .update({ password_hash: passwordHash, verify_token: null, token_expires_at: null, email_verified: true })
      .eq("id", user.id);
    // Yazım düştüyse "başarılı" deyip oturumları silmek kullanıcıyı eski şifresiyle dışarıda bırakırdı.
    if (updateError) throw Errors.SERVER_ERROR();

    // Delete all refresh tokens for this user
    await supabase
      .from("refresh_tokens")
      .delete()
      .eq("user_id", user.id);

    return { userId: user.id };
  }

  async socialLogin(data: {
    provider: "google" | "apple";
    id_token: string;
    name?: string;
    surname?: string;
    nonce?: string;
    locale?: string;
  }, client: ClientMeta = {}) {
    // 1. Token verify
    let socialPayload: SocialAuthPayload;
    try {
      if (data.provider === "google") {
        socialPayload = await verifyGoogleToken(data.id_token);
      } else {
        socialPayload = await verifyAppleToken(data.id_token, data.nonce);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error("[social-login] Token verification failed:", err);
      throw Errors.SOCIAL_AUTH_FAILED();
    }

    const email = normalizeEmail(socialPayload.email);
    const providerId = socialPayload.providerId;
    const name = socialPayload.name || data.name || "";
    const surname = socialPayload.surname || data.surname || "";

    // 2. Case A: provider_id match → login
    const { data: existingByProvider } = await supabase
      .from("users")
      .select("id, email, is_deleted, is_banned, age, name, surname, email_verified")
      .eq("provider_id", providerId)
      .maybeSingle();

    // Silinmis hesabin yeniden girisi (asagidaki iki purge dali) Case C'de yeni hesap acar
    // ama baslangic paketini tekrar ALMAZ (bedava SKIP_ALL dongusu).
    let purged = false;
    if (existingByProvider) {
      // Ban once bakilir: silinmis + banli hesap purge edilirse ban kacirilir.
      if (existingByProvider.is_banned) throw Errors.ACCOUNT_BANNED();
      if (existingByProvider.is_deleted) {
        // Soft-deleted: hard delete + fall through (Case B/C will create a fresh account).
        // Mirrors Case B (email match) behavior — symmetric recovery for re-signups.
        await accountPurgeService.hardDeleteUser(existingByProvider.id);
        purged = true;
      } else {
        // Backfill name/surname if missing and provider gave them this round (e.g. first sign-in
        // saved an empty name due to a client bug — recover next time Apple/Google sends them).
        const backfill: Record<string, string | boolean> = {};
        if (!existingByProvider.name && name) backfill.name = name;
        if (!existingByProvider.surname && surname) backfill.surname = surname;
        // E-postayla açılıp doğrulanmadan sosyal hesaba bağlanmış eski hesaplar: sağlayıcı aynı
        // e-postayı kanıtladı, mesaj kapısında (emailVerifiedGuard) takılmasınlar.
        // Yalnız sağlayıcı AYNI e-postayı doğrulamışsa.
        const providerProvesEmail = socialPayload.emailVerified && !!email && email === existingByProvider.email;
        if (existingByProvider.email_verified !== true && providerProvesEmail) backfill.email_verified = true;
        if (Object.keys(backfill).length > 0) {
          const { error: backfillError } = await supabase.from("users").update(backfill).eq("id", existingByProvider.id);
          if (backfillError) throw Errors.SERVER_ERROR();
        }
        return this.createSocialSession(
          existingByProvider.id,
          existingByProvider.email,
          existingByProvider.age,
          existingByProvider.email_verified === true || backfill.email_verified === true,
        );
      }
    }

    // 3. Case B: email match → link account
    if (email) {
      const { data: existingByEmail } = await supabase
        .from("users")
        .select("id, email, is_deleted, is_banned, age, provider_id, name, surname, email_verified")
        .eq("email", email)
        .maybeSingle();

      if (existingByEmail) {
        if (existingByEmail.is_banned) throw Errors.ACCOUNT_BANNED();
        if (existingByEmail.is_deleted) {
          await accountPurgeService.hardDeleteUser(existingByEmail.id);
          purged = true;
        } else {
          // Bağlama e-posta sahipliğine dayanır: sağlayıcı e-postayı doğrulamadıysa (Google'da
          // doğrulanmamış adresle hesap açılabilir) başkasının hesabına girmenin yolu olurdu.
          if (!socialPayload.emailVerified) throw Errors.EMAIL_ALREADY_EXISTS();
          const linkUpdate: Record<string, string | boolean | null> = {};
          if (!existingByEmail.provider_id) {
            linkUpdate.provider_id = providerId;
            linkUpdate.auth_provider = data.provider;
          }
          if (!existingByEmail.name && name) linkUpdate.name = name;
          if (!existingByEmail.surname && surname) linkUpdate.surname = surname;
          // Sağlayıcı bu e-postayı kanıtladı: doğrulanmamış e-posta hesabı burada doğrulanmış olur.
          if (existingByEmail.email_verified !== true) {
            linkUpdate.email_verified = true;
            // Ön-hesap ele geçirme savunması: giriş artık doğrulamasız olduğundan biri bu e-postayla
            // kendi şifresiyle kayıt olmuş olabilir. Gerçek sahip sağlayıcıyla kanıtladı → doğrulanmamış
            // dönemin kimlik bilgileri (şifre + açık oturumlar) düşer; şifreye "şifremi unuttum" ile döner.
            linkUpdate.password_hash = null;
            const { error: revokeError } = await supabase.from("refresh_tokens").delete().eq("user_id", existingByEmail.id);
            if (revokeError) throw Errors.SERVER_ERROR();
          }
          if (Object.keys(linkUpdate).length > 0) {
            const { error: linkError } = await supabase.from("users").update(linkUpdate).eq("id", existingByEmail.id);
            if (linkError) throw Errors.SERVER_ERROR();
          }
          return this.createSocialSession(existingByEmail.id, existingByEmail.email, existingByEmail.age, true);
        }
      }
    }

    // 4. Case C: New user
    const referralCode = await referralService.generateUniqueCode();
    // Sosyal giriste locale serbest string (validator enum degil) — localeProvider'in
    // Locale.toString() ciktisi bolgeli olabilir (tr_TR gibi), localeFromTag alt etiketi
    // soyup dogru dile cozer; bilinmeyen -> en. Uygulama dili = eslesme tercihinin ana degeri.
    const locale = localeFromTag(data.locale);
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        email: email || `${providerId}@social.qulo.app`,
        name,
        surname,
        auth_provider: data.provider,
        provider_id: providerId,
        // Sağlayıcı doğruladıysa (pratikte her zaman); açıkça doğrulanmamış Google adresi mesaj kapısına takılır.
        email_verified: socialPayload.emailVerified,
        referral_code: referralCode,
        locale,
        preferred_languages: [locale],
        // is_test_admin sunucu-only: sosyal kayit (Apple/Google) Case C insert'i alani
        // set etmedigi surece DB default'una bagimliydi; Haziran-Eylul 2026 drift'inde
        // (default `true`) 48 Apple relay + 51 Google hesabi yanlisligiyla test_admin
        // isaretlendi. Migration 073 default'u false'a cekti, kod artik acikca yaziyor.
        is_test_admin: false,
        // Rainbow ana anahtari kapaliyken tek kapi bu bayrak (ayni drift savunmasi).
        is_test_account: false,
      })
      .select("id, email, age")
      .single();

    if (insertError || !newUser) {
      console.error("[social-login] Insert user failed:", insertError?.message);
      throw Errors.SERVER_ERROR();
    }

    consentService.recordRegistrationConsents(newUser.id, client).catch((err) => {
      console.error("[social-login] Failed to record consents:", err);
    });

    // Baslangic paketi yalniz gercekten ilk hesaba (bkz. `purged`).
    if (!purged) void exchangeService.grantStarterPack(newUser.id);
    // Kayit ile ayni politika: sutun INSERT'te dolu, RPC turev tabloyu tamamlar, fail-open.
    try {
      await userLanguageService.setUserLanguages(newUser.id, [locale]);
    } catch (err) {
      console.error("[social-login] Failed to sync languages:", err);
    }

    return this.createSocialSession(newUser.id, newUser.email, newUser.age, socialPayload.emailVerified);
  }

  private async createSocialSession(userId: string, email: string, age: number | null, emailVerified: boolean) {
    const session = await this.createSession(userId, email);
    return { ...session, userId, profileIncomplete: age == null, emailVerified };
  }

  /** Token çifti üretir, refresh token'ı saklar, kullanıcıyı çevrimiçi işaretler (kayıt/giriş/sosyal ortak). */
  private async createSession(userId: string, email: string) {
    const payload = { userId, email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    const refreshTokenHash = hashToken(refreshToken);

    await Promise.all([
      supabase.from("refresh_tokens").insert({
        user_id: userId,
        token_hash: refreshTokenHash,
        expires_at: getRefreshTokenExpiry(),
      }),
      supabase
        .from("users")
        .update({ last_seen_at: new Date().toISOString(), is_online: true })
        .eq("id", userId),
    ]);

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
