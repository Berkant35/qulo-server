import { supabase } from "../config/supabase.js";
import type { ClientMeta, ClientPlatform } from "../utils/client-meta.js";

type ConsentType = "terms_of_service" | "privacy_policy" | "kvkk_explicit";

interface RecordConsentInput {
  userId: string;
  consentType: ConsentType;
  version?: string;
  appVersion?: string;
  platform?: ClientPlatform;
}

class ConsentService {
  async recordConsent(input: RecordConsentInput) {
    const { error } = await supabase.from("user_consents").upsert(
      {
        user_id: input.userId,
        consent_type: input.consentType,
        version: input.version ?? "1.0",
        app_version: input.appVersion,
        platform: input.platform,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,consent_type,version" },
    );

    if (error) {
      console.error("[consent] Failed to record consent:", error.message);
      throw new Error(`Consent recording failed: ${error.code}`);
    }
  }

  /**
   * Kayit anindaki uc zorunlu riza (KVKK denetim izi). Platform + surum istemci
   * basliklarindan gelir; eski istemcide bos kalir, riza yine de kaydedilir.
   *
   * IP bilincli olarak YAZILMAZ: gizlilik politikasi IP toplamayi aciklamiyor.
   * Politika guncellenirse `ClientMeta`'ya eklenip buradan gecirilir.
   */
  async recordRegistrationConsents(userId: string, client: ClientMeta = {}) {
    const types: ConsentType[] = ["terms_of_service", "privacy_policy", "kvkk_explicit"];
    await Promise.all(
      types.map((consentType) =>
        this.recordConsent({
          userId,
          consentType,
          appVersion: client.appVersion,
          platform: client.platform,
        }),
      ),
    );
  }
}

export const consentService = new ConsentService();
