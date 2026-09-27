import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { diamondService } from "./diamond.service.js";

/** İade edenin satın almadan sonraki ödenmiş harcamaları — pratikte birkaç düzine satır. */
const SPEND_SCAN_LIMIT = 500;
/** `.in()` listesi URL'ye yazılır (PostgREST): uzun listeyi dilimle (`.in()` tuzağı, 2026-09-17). */
const IN_CHUNK = 100;
/** Dilim başına rainbow alıcı satırı: PostgREST max-rows (1000) — sessiz kırpma yerine uyarı. */
const RECIPIENT_SCAN_LIMIT = 1000;
/** Claim'e yazılamayan kullanıcı: FK (bilinmeyen id) ya da uuid olmayan RevenueCat kimliği. */
const UNKNOWN_USER_CODES = new Set(["23503", "22P02"]);

export interface ConsumableRefund {
  /** RevenueCat app_user_id. Kredinin kime yazıldığını defter söyler; bu yalnız yedek. */
  userId: string;
  transactionId: string;
  productId: string;
  store: "apple" | "google";
  priceUsd: number | null;
  /** RevenueCat `environment`: yalnız PRODUCTION iadesi işlenir (sandbox satın alma rainbow üretmez). */
  environment: string | null;
  /** RevenueCat `cancel_reason` (ör. CUSTOMER_SUPPORT) — yalnız loglanır. */
  cancelReason: string | null;
}

interface PurchaseRow {
  user_id: string;
  paid_amount: number | null;
  created_at: string;
}

/**
 * Tüketilebilir IAP iadesinin rainbow sonuçları (spec §2.7; Plan 2 kararı "uyarı yayılsın").
 * Bakiye GERİ ALINMAZ (bugünkü politika). Yalnız:
 *  1) iade eden VE (satın alma ödenmişse) onun satın almadan sonraki ödenmiş harcamalarından
 *     rainbow kazananlar `rainbow_flagged_at` ile işaretlenir — admin itfa kuyruğunda uyarıyı görür,
 *  2) satın almanın ödenmiş payı `purple_paid` sayacından düşer (kalan mor bedava sayılır) — EN SON:
 *     önceki adım patlarsa claim bırakılır ve tekrar deneme sayacı ikinci kez düşürmez.
 * Harcama → ödül bağı defter referansıdır (quiz: session id, sohbet: soru id). Fazla işaretleme
 * (başka bir satın almanın ödenmiş morundan kazanan) kabul: işaret yalnız uyarıdır, engel değil.
 */
export class RainbowRiskService {
  async handleConsumableRefund(refund: ConsumableRefund): Promise<void> {
    if (!refund.transactionId) {
      console.warn("[rainbow-risk] refund without transaction_id ignored", {
        userId: refund.userId, productId: refund.productId,
      });
      return;
    }
    if (refund.environment !== "PRODUCTION") {
      console.log("[rainbow-risk] non-production refund ignored", {
        environment: refund.environment, transactionId: refund.transactionId, cancelReason: refund.cancelReason,
      });
      return;
    }

    // Önce OKUMA: claim satırı gerçek alıcıya yazılsın (RevenueCat kimliği hesap değişince farklı olabilir).
    const purchase = await this.findPurchase(refund.transactionId);
    const refunderId = purchase?.user_id ?? refund.userId;

    const claimId = await this.claim(refund, refunderId);
    if (!claimId) return;

    let revokedPaid = 0;
    try {
      // Ödenmemiş satın alma (sandbox/aile paylaşımı) rainbow üretmedi: alıcı aranmaz; iade eden yine
      // işaretlenir (gerçek iade = chargeback sinyali).
      const paid = purchase?.paid_amount ?? 0;
      const recipients = purchase && paid > 0 ? await this.findRewardRecipients(refunderId, purchase.created_at) : [];
      await this.flagUsers([refunderId, ...recipients]);
      revokedPaid = paid > 0 ? await diamondService.revokePaid(refunderId, paid) : 0;

      console.log("[rainbow-risk] consumable refund processed", {
        transactionId: refund.transactionId, refunderId, purchaseFound: purchase !== null,
        cancelReason: refund.cancelReason, revokedPaid, flaggedRecipients: recipients.length,
      });
    } catch (err) {
      // Claim bırakılır ki RevenueCat yeniden desin. Sayaç düşümü son adım: ondan önceki hata sayacı
      // hiç düşürmemiştir; işaretleme zaten tekrarlanabilir.
      const { error: releaseErr } = await supabase.from("iap_transactions").delete().eq("id", claimId);
      if (releaseErr) {
        console.error("[rainbow-risk] refund claim release failed — retry will be skipped", {
          claimId, transactionId: refund.transactionId, error: releaseErr.message,
        });
      }
      throw err;
    }

    await this.recordRevoked(claimId, refund.transactionId, revokedPaid);
  }

  /**
   * `refund:<tx>` claim'i: tekrarlanan olay 23505'e takılır (iap_transactions.transaction_id UNIQUE).
   * `purple_credited` şimdilik null; iş bitince `recordRevoked` doldurur.
   */
  private async claim(refund: ConsumableRefund, refunderId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("iap_transactions")
      .insert({
        user_id: refunderId,
        product_id: refund.productId,
        store: refund.store,
        transaction_id: `refund:${refund.transactionId}`,
        rc_event_type: "CANCELLATION",
        amount_usd: refund.priceUsd,
        purple_credited: null,
      })
      .select("id")
      .single();

    if (error?.code === "23505") return null; // bu iade zaten işlendi
    if (error?.code && UNKNOWN_USER_CODES.has(error.code)) {
      // Bilinmeyen kullanıcı (FK) ya da uuid olmayan kimlik: yeniden denemek düzeltmez — sonsuz retry'a sokma.
      console.warn("[rainbow-risk] refund for unknown user ignored", {
        userId: refunderId, transactionId: refund.transactionId, code: error.code,
      });
      return null;
    }
    if (error || !data) throw Errors.SERVER_ERROR();
    return (data as { id: string }).id;
  }

  /**
   * Kalıcı iz: claim satırının `purple_credited`'ı NEGATİF = bu iadenin geri aldığı ödenmiş mor
   * (bakiye dokunulmadı). İş bitti; yazılamazsa yalnız loglanır (claim kalır, tekrar deneme atlanır).
   */
  private async recordRevoked(claimId: string, transactionId: string, revokedPaid: number): Promise<void> {
    const { error } = await supabase
      .from("iap_transactions")
      .update({ purple_credited: revokedPaid > 0 ? -revokedPaid : 0 })
      .eq("id", claimId);
    if (error) {
      console.error("[rainbow-risk] refund processed but claim record update failed", {
        claimId, transactionId, revokedPaid, error: error.message,
      });
    }
  }

  /** Satın alma defter satırı: referans mağaza işlem numarası (istemci + webhook yolu aynı, 068 tekil). */
  private async findPurchase(transactionId: string): Promise<PurchaseRow | null> {
    const { data, error } = await supabase
      .from("diamond_transactions")
      .select("user_id, paid_amount, created_at")
      .eq("reason", "IAP_PURCHASE")
      .eq("reference_id", transactionId)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return (data as PurchaseRow | null) ?? null;
  }

  /** İade edenin `since`'ten sonraki ödenmiş harcamalarının referanslarından rainbow kazananlar. */
  private async findRewardRecipients(refunderId: string, since: string): Promise<string[]> {
    const { data: spends, error } = await supabase
      .from("diamond_transactions")
      .select("reference_id")
      .eq("user_id", refunderId)
      .eq("type", "PURPLE")
      .lt("amount", 0)
      .gt("paid_amount", 0)
      .gte("created_at", since)
      .not("reference_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(SPEND_SCAN_LIMIT);
    if (error) throw Errors.SERVER_ERROR();
    const spendRows = (spends ?? []) as { reference_id: string }[];
    if (spendRows.length >= SPEND_SCAN_LIMIT) {
      console.warn("[rainbow-risk] spend scan limit hit — later spends not checked", { refunderId, since, limit: SPEND_SCAN_LIMIT });
    }

    const refs = [...new Set(spendRows.map((s) => s.reference_id))];
    const recipients = new Set<string>();
    for (let i = 0; i < refs.length; i += IN_CHUNK) {
      const { data: earned, error: earnedErr } = await supabase
        .from("diamond_transactions")
        .select("user_id")
        .eq("type", "RAINBOW")
        .gt("amount", 0)
        .in("reference_id", refs.slice(i, i + IN_CHUNK))
        .neq("user_id", refunderId)
        .limit(RECIPIENT_SCAN_LIMIT);
      if (earnedErr) throw Errors.SERVER_ERROR();
      const earnedRows = (earned ?? []) as { user_id: string }[];
      if (earnedRows.length >= RECIPIENT_SCAN_LIMIT) {
        console.warn("[rainbow-risk] recipient scan limit hit — some recipients may be unflagged", {
          refunderId, chunkStart: i, limit: RECIPIENT_SCAN_LIMIT,
        });
      }
      for (const row of earnedRows) recipients.add(row.user_id);
    }
    return [...recipients];
  }

  /** İlk işaret zamanı korunur: yalnız henüz işaretsiz kullanıcılar yazılır. */
  private async flagUsers(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { error } = await supabase
        .from("users")
        .update({ rainbow_flagged_at: now })
        .in("id", ids.slice(i, i + IN_CHUNK))
        .is("rainbow_flagged_at", null);
      if (error) throw Errors.SERVER_ERROR();
    }
  }
}

export const rainbowRiskService = new RainbowRiskService();
