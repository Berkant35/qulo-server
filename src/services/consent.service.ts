import { supabase } from "../config/supabase.js";

type ConsentType = "terms_of_service" | "privacy_policy" | "kvkk_explicit";

interface RecordConsentInput {
  userId: string;
  consentType: ConsentType;
  version?: string;
  ipAddress?: string;
  appVersion?: string;
  platform?: string;
}

class ConsentService {
  async recordConsent(input: RecordConsentInput) {
    const { error } = await supabase.from("user_consents").upsert(
      {
        user_id: input.userId,
        consent_type: input.consentType,
        version: input.version ?? "1.0",
        ip_address: input.ipAddress,
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

  async recordRegistrationConsents(
    userId: string,
    ipAddress?: string,
    appVersion?: string,
    platform?: string,
  ) {
    const types: ConsentType[] = ["terms_of_service", "privacy_policy", "kvkk_explicit"];
    await Promise.all(
      types.map((consentType) =>
        this.recordConsent({ userId, consentType, ipAddress, appVersion, platform }),
      ),
    );
  }

  async getUserConsents(userId: string) {
    const { data, error } = await supabase
      .from("user_consents")
      .select("consent_type, version, accepted_at")
      .eq("user_id", userId)
      .order("accepted_at", { ascending: false });

    if (error) {
      console.error("[consent] Failed to get consents:", error.message);
      return [];
    }
    return data ?? [];
  }
}

export const consentService = new ConsentService();
