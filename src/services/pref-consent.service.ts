import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import type { ClientMeta } from "../utils/client-meta.js";
import type { PrefConsentInput } from "../validators/user.validator.js";
import { consentService } from "./consent.service.js";

const PREF_STATE_COLUMNS = "gender_pref, gender_pref_set_at, pref_consent_status";

type PrefState = {
  gender_pref: string | null;
  gender_pref_set_at: string | null;
  pref_consent_status: string | null;
};

/**
 * Eşleşme tercihi açık rızası (spec 2026-10-05 §6). Durum users'ta (hızlı sorgu), ispat
 * user_consents'te. Tercih kilidi korunur: ilk seçimden sonra değişiklik yalnız backoffice'ten.
 */
class PrefConsentService {
  async setConsent(userId: string, input: PrefConsentInput, client: ClientMeta = {}) {
    const current = await this.read(userId);
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

    const firstChoice = current.gender_pref_set_at == null;
    let updates: Record<string, unknown>;
    if (firstChoice) {
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
    const keptPref = firstChoice ? input.gender_pref! : current.gender_pref;
    return this.writeGranted(userId, current, firstChoice, updates, keptPref);
  }

  /**
   * GRANTED yazımı compare-and-set: okuma ile yazım arasında (ispat kaydı sürerken) araya giren
   * DECLINED ya da backoffice değişikliği ezilmez. Aksi halde DECLINED'ın sildiği tercih
   * (set_at NULL) üstüne GRANTED yazılır, kullanıcı yeni tercih seçebilirdi — kilidin arka kapısı.
   * Yarışı kaybeden GRANTED'ın ispat satırı kalır; zararsız (rıza denemesinin denetim izi).
   */
  private async writeGranted(
    userId: string, current: PrefState, firstChoice: boolean, updates: Record<string, unknown>, keptPref: string | null,
  ) {
    let query = supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .eq("is_deleted", false)
      .or("pref_consent_status.is.null,pref_consent_status.eq.GRANTED");
    if (firstChoice) {
      query = query.is("gender_pref_set_at", null);
    } else {
      query = query.not("gender_pref_set_at", "is", null);
      query = current.gender_pref == null ? query.is("gender_pref", null) : query.eq("gender_pref", current.gender_pref);
    }
    const { data, error } = await query.select(PREF_STATE_COLUMNS).maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (data) return data;

    const now = await this.read(userId);
    if (now.pref_consent_status === "DECLINED") throw Errors.CONSENT_RELOCK();
    // Aynı rızanın eşzamanlı tekrarı (ör. yanıtı kaybolan istemcinin yeniden denemesi) idempotent.
    if (now.pref_consent_status === "GRANTED" && now.gender_pref_set_at != null && now.gender_pref === keptPref) return now;
    throw Errors.GENDER_PREF_LOCKED();
  }

  private async read(userId: string): Promise<PrefState> {
    const { data, error } = await supabase
      .from("users")
      .select(PREF_STATE_COLUMNS)
      .eq("id", userId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
    return data as PrefState;
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
