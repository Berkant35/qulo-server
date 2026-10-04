import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { generateToken, hashToken } from "../utils/hash.js";
import { sendVerificationEmail } from "../utils/email.js";
import { TtlCache } from "../utils/ttl-cache.js";
import { referralService } from "./referral.service.js";

/** Doğrulama bağlantısı ömrü — kayıt ve yeniden gönderim aynı süreyi kullanır. */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Kapı önbelleği (bkz. `middleware/emailVerifiedGuard`): her mesajda `users.email_verified` okunmasın.
 * Yalnız `true` yazılır — doğrulama tek yönlü (doğrulama, şifre sıfırlama, sosyal bağlama hep true yazar;
 * false'a dönüş yolu yok), olumlu sonuç bayatlayamaz. Doğrulanmamış kullanıcı her denemede yeniden
 * okunur: doğruladığı anda kapı açılır, invalidation gerekmez.
 */
export const EMAIL_VERIFIED_TTL_MS = 60 * 60_000;

/** Düz token e-postaya, hash'i DB'ye (`verify_token`), bitiş `token_expires_at`'e. */
export function issueVerifyToken(): { token: string; hash: string; expiresAt: string } {
  const token = generateToken();
  return { token, hash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString() };
}

/**
 * E-posta doğrulama: durum (kapı), bağlantıyla doğrulama, yeniden gönderim.
 * "Önce içeri al" (2026-10-04): giriş doğrulamasız; doğrulama yalnız eşleşmeye ilk yazımda istenir.
 */
class EmailVerificationService {
  private readonly onbellek = new TtlCache<string, true>(EMAIL_VERIFIED_TTL_MS);

  /** Okuma hatası fırlatılır: kapı fail-closed (mesaj yazımı zaten DB'ye bağlı). */
  async isVerified(userId: string): Promise<boolean> {
    // Doğrulanmamış → `undefined` (önbelleğe yazılmaz), hata → fırlatılır (yazılmaz).
    const sonuc = await this.onbellek.getOrLoad(userId, async () => {
      const { data, error } = await supabase
        .from("users")
        .select("email_verified")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`email_verified okunamadi: ${error.message}`);
      return data?.email_verified === true ? true : undefined;
    });
    return sonuc === true;
  }

  async verify(token: string): Promise<{ userId: string }> {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, token_expires_at, profile_completion")
      .eq("verify_token", hashToken(token))
      .eq("email_verified", false)
      .maybeSingle();

    if (error || !user) throw Errors.INVALID_TOKEN();
    if (user.token_expires_at && new Date(user.token_expires_at) < new Date()) throw Errors.TOKEN_EXPIRED();

    const { error: updateError } = await supabase
      .from("users")
      .update({ email_verified: true, verify_token: null, token_expires_at: null })
      .eq("id", user.id);
    if (updateError) throw Errors.SERVER_ERROR();

    // Davet ödülü doğrulama ister (tek kullanımlık e-postalarla çiftçilik): profili zaten %60'ı
    // geçmiş kullanıcının bekleyen ödülü doğrulama anında verilir. Best effort.
    try {
      await referralService.checkAndReward(user.id, user.profile_completion ?? 0);
    } catch (err) {
      console.error("[email-verification] referral check failed:", err instanceof Error ? err.message : err);
    }
    return { userId: user.id };
  }

  /**
   * Doğrulama e-postasını yeniden gönderir. Zaten doğrulanmışsa (sosyal giriş dahil) e-posta
   * gitmez. Yeni token eskisini geçersiz kılar (tek `verify_token` sütunu — bekleyen bir şifre
   * sıfırlama bağlantısı da düşer; ikisi de aynı kutuya gider). Hız sınırı rotada (kullanıcı başına).
   */
  async resend(userId: string): Promise<{ emailVerified: boolean; sent: boolean }> {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, locale, email_verified")
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) throw Errors.SERVER_ERROR();
    if (!user) throw Errors.USER_NOT_FOUND();
    if (user.email_verified) return { emailVerified: true, sent: false };

    const { token, hash, expiresAt } = issueVerifyToken();
    const { error: updateError } = await supabase
      .from("users")
      .update({ verify_token: hash, token_expires_at: expiresAt })
      .eq("id", user.id)
      .eq("email_verified", false);
    if (updateError) throw Errors.SERVER_ERROR();

    // Kullanıcı açıkça istedi: gönderim hatası yutulmaz, istemci yeniden deneyebilsin.
    try {
      await sendVerificationEmail(user.email, token, user.locale ?? undefined);
    } catch (err) {
      console.error("[email-verification] resend failed:", err instanceof Error ? err.message : err);
      throw Errors.SERVER_ERROR();
    }
    return { emailVerified: false, sent: true };
  }
}

export const emailVerificationService = new EmailVerificationService();
