import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import type { ClientMeta } from "../utils/client-meta.js";
import type { PrefConsentInput } from "../validators/user.validator.js";
import { consentService } from "./consent.service.js";

const PREF_STATE_COLUMNS = "gender_pref, gender_pref_set_at, pref_consent_status";

/**
 * Eşleşme tercihi açık rızası (spec 2026-10-05 §6). Durum users'ta (hızlı sorgu), ispat
 * user_consents'te. Tercih kilidi korunur: ilk seçimden sonra değişiklik yalnız backoffice'ten.
 */
class PrefConsentService {
  async setConsent(userId: string, input: PrefConsentInput, client: ClientMeta = {}) {
    const { data: current, error } = await supabase
      .from("users")
      .select(PREF_STATE_COLUMNS)
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!current) throw Errors.USER_NOT_FOUND();
    const now = new Date().toISOString();

    if (input.status === "DECLINED") {
      // Rıza yoksa tercih saklanmaz: silinir, kullanıcı "Herkes" modunda devam eder.
      return this.write(userId, {
        gender_pref: null, gender_pref_set_at: null, pref_consent_status: "DECLINED", pref_consent_at: now,
      });
    }

    // Geri alınmış rıza uygulamadan yeniden verilemez: "geri al → yeniden ver → farklı tercih"
    // tercih kilidini dolanmanın yolu olurdu. Yeniden tercih destek talebiyle.
    if (current.pref_consent_status === "DECLINED") throw Errors.CONSENT_RELOCK();

    let updates: Record<string, unknown>;
    if (current.gender_pref_set_at == null) {
      if (!input.gender_pref) throw Errors.GENDER_PREF_REQUIRED();
      updates = { gender_pref: input.gender_pref, gender_pref_set_at: now, pref_consent_status: "GRANTED", pref_consent_at: now };
    } else {
      // Eski (rızasız alınmış) ya da backoffice'ten değişmiş tercih: değer korunur, rıza yazılır.
      if (input.gender_pref && input.gender_pref !== current.gender_pref) throw Errors.GENDER_PREF_LOCKED();
      updates = { pref_consent_status: "GRANTED", pref_consent_at: now };
    }

    // İspat önce: kayıt düşerse durum yazılmaz (rızasız işleme olmasın).
    await consentService.recordConsent({
      userId, consentType: "match_preference", version: input.version,
      appVersion: client.appVersion, platform: client.platform,
    });
    return this.write(userId, updates);
  }

  private async write(userId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .eq("is_deleted", false)
      .select(PREF_STATE_COLUMNS)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
    return data;
  }
}

export const prefConsentService = new PrefConsentService();
