import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { economyConfigService } from "./economy-config.service.js";
import { Errors } from "../utils/errors.js";
import {
  isRetentionEligibleReason,
  RETENTION_BONUS_REASON,
} from "../constants/deletion-reasons.js";

/**
 * Hesap silme öncesi "kal, 15 mor elmas hediye" win-back teklifi.
 * Uygunluk SADECE server'da belirlenir; client'a güvenilmez.
 *
 * Uygunluk kapıları (TÜMÜ sağlanmalı — AND):
 *  1. reason_code adreslenebilir negatif churn içinde
 *  2. Kullanıcı bu grant'ı daha önce almamış (once-per-user)
 *  3. Kullanıcının aktif eşleşmesi YOK (varsa çekirdek değeri zaten almış)
 *  4. Hesap yaşı > minAccountAgeDays (farming önleme)
 */
class RetentionService {
  /** Teklif gösterilmeli mi + verilecek miktar. */
  async checkEligibility(
    userId: string,
    reasonCode: string,
  ): Promise<{ eligible: boolean; amount: number }> {
    const { config } = await economyConfigService.getActiveConfig();
    const amount = config.retention.deletionDiamondAmount;
    const minAgeDays = config.retention.minAccountAgeDays;

    // Kapı 1: uygun neden
    if (!isRetentionEligibleReason(reasonCode)) {
      return { eligible: false, amount };
    }

    // Kapı 2: daha önce almamış (reason-spesifik — reference_id UUID olduğu için string kodlanamaz)
    const { data: prior } = await supabase
      .from("diamond_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", RETENTION_BONUS_REASON)
      .maybeSingle();
    if (prior) {
      return { eligible: false, amount };
    }

    // Kapı 3: aktif eşleşme yok
    const { data: match } = await supabase
      .from("matches")
      .select("id")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (match) {
      return { eligible: false, amount };
    }

    // Kapı 4: hesap yaşı
    const { data: user } = await supabase
      .from("users")
      .select("created_at")
      .eq("id", userId)
      .maybeSingle();
    if (user?.created_at) {
      const ageDays =
        (Date.now() - new Date(user.created_at).getTime()) / 86_400_000;
      if (ageDays < minAgeDays) {
        return { eligible: false, amount };
      }
    }

    return { eligible: true, amount };
  }

  /**
   * Teklifi kabul et: uygunluğu SUNUCUDA tekrar doğrula, sonra grant.
   * referenceId = userId (UUID) → addPurple içindeki duplicate guard ikinci kez vermeyi engeller.
   */
  async claim(userId: string, reasonCode: string): Promise<{ granted: number }> {
    const { eligible, amount } = await this.checkEligibility(userId, reasonCode);
    if (!eligible) {
      throw Errors.RETENTION_NOT_ELIGIBLE();
    }

    await diamondService.addPurple(
      userId,
      amount,
      RETENTION_BONUS_REASON,
      userId,
    );

    return { granted: amount };
  }
}

export const retentionService = new RetentionService();
