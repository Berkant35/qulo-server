import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import type { ClientMeta } from "../utils/client-meta.js";
import type { IdentityInput } from "../validators/identity.validator.js";
import { IDENTITY_CONSENT_VERSION } from "../constants/identity-labels.js";
import { consentService } from "./consent.service.js";

const STATE_COLUMNS = "gender_labels, orientation_labels, show_gender_labels, show_orientation_labels";
const IN_CHUNK = 100;

export interface IdentityState {
  gender_labels: string[];
  orientation_labels: string[];
  show_gender_labels: boolean;
  show_orientation_labels: boolean;
}

/** Başkasına dönen kısım: yalnız görünür ve dolu gruplar. */
export interface VisibleIdentity {
  gender_labels?: string[];
  orientation_labels?: string[];
}

const EMPTY: IdentityState = {
  gender_labels: [], orientation_labels: [], show_gender_labels: false, show_orientation_labels: false,
};

/**
 * Kimlik & yönelim etiketleri (spec 2026-10-06). Ayrı ve PostgREST'e kapalı tablo; ayrı amaçlı açık
 * rıza (identity_labels). Eşleşmeye etkisi yok. Etiket değerleri log'a yazılmaz.
 */
class IdentityService {
  async getMine(userId: string): Promise<IdentityState> {
    const { data, error } = await supabase
      .from("user_identity")
      .select(STATE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return (data as IdentityState | null) ?? { ...EMPTY };
  }

  async save(userId: string, input: IdentityInput, client: ClientMeta = {}): Promise<IdentityState> {
    // İki liste boş = etiketleri sil = rızayı geri al (satır kalmaz, görünürlük anlamsız).
    if (input.gender_labels.length === 0 && input.orientation_labels.length === 0) {
      await this.removeFor(userId);
      return { ...EMPTY };
    }
    if (input.consent !== true) throw Errors.IDENTITY_CONSENT_REQUIRED();

    // İspat önce: kayıt düşerse etiket yazılmaz (rızasız işleme olmasın).
    await consentService.recordConsent({
      userId, consentType: "identity_labels", version: input.version ?? IDENTITY_CONSENT_VERSION,
      appVersion: client.appVersion, platform: client.platform,
    });

    const { data, error } = await supabase
      .from("user_identity")
      .upsert(
        {
          user_id: userId,
          gender_labels: input.gender_labels,
          orientation_labels: input.orientation_labels,
          show_gender_labels: input.show_gender_labels,
          show_orientation_labels: input.show_orientation_labels,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select(STATE_COLUMNS)
      .single();
    if (error || !data) throw Errors.SERVER_ERROR();
    return data as IdentityState;
  }

  /** Hesap silme ve "etiketlerimi sil" — satırı kaldırır. */
  async removeFor(userId: string): Promise<void> {
    const { error } = await supabase.from("user_identity").delete().eq("user_id", userId);
    if (error) throw Errors.SERVER_ERROR();
  }

  /** Discover / profil detayı: yalnız `show_*` true ve dolu gruplar. `.in()` ≤ 100 id. */
  async visibleFor(userIds: string[]): Promise<Map<string, VisibleIdentity>> {
    const result = new Map<string, VisibleIdentity>();
    for (let i = 0; i < userIds.length; i += IN_CHUNK) {
      const part = userIds.slice(i, i + IN_CHUNK);
      const { data, error } = await supabase
        .from("user_identity")
        .select(`user_id, ${STATE_COLUMNS}`)
        .in("user_id", part)
        .or("show_gender_labels.eq.true,show_orientation_labels.eq.true");
      if (error) throw Errors.SERVER_ERROR();
      for (const row of (data ?? []) as Array<IdentityState & { user_id: string }>) {
        const visible: VisibleIdentity = {};
        if (row.show_gender_labels && row.gender_labels.length > 0) visible.gender_labels = row.gender_labels;
        if (row.show_orientation_labels && row.orientation_labels.length > 0) visible.orientation_labels = row.orientation_labels;
        if (visible.gender_labels || visible.orientation_labels) result.set(row.user_id, visible);
      }
    }
    return result;
  }
}

export const identityService = new IdentityService();
