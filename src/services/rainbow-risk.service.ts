import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { diamondService } from "./diamond.service.js";

/** İade edenin satın almadan sonraki ödenmiş harcamaları — pratikte birkaç düzine satır. */
const SPEND_SCAN_LIMIT = 500;
/** `.in()` listesi URL'ye yazılır (PostgREST): uzun listeyi dilimle (`.in()` tuzağı, 2026-09-17). */
const IN_CHUNK = 100;

export interface ConsumableRefund {
  /** RevenueCat app_user_id. Kredinin kime yazıldığını defter söyler; bu yalnız yedek. */
  userId: string;
  transactionId: string;
  productId: string;
  store: "apple" | "google";
  priceUsd: number | null;
}

interface PurchaseRow {
  user_id: string;
  paid_amount: number | null;
  created_at: string;
}

/**
 * Tüketilebilir IAP iadesinin rainbow sonuçları (spec §2.7; Plan 2 kararı "uyarı yayılsın").
 * Bakiye GERİ ALINMAZ (bugünkü politika). Yalnız:
 *  1) satın almanın ödenmiş payı `purple_paid` sayacından düşer (kalan mor bedava sayılır),
 *  2) iade eden VE onun satın almadan sonraki ödenmiş harcamalarından rainbow kazananlar
 *     `rainbow_flagged_at` ile işaretlenir — admin itfa kuyruğunda uyarıyı görür, kararı o verir.
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

    const claimId = await this.claim(refund);
    if (!claimId) return;

    try {
      const purchase = await this.findPurchase(refund.transactionId);
      const refunderId = purchase?.user_id ?? refund.userId;
      const revokedPaid = purchase && (purchase.paid_amount ?? 0) > 0
        ? await diamondService.revokePaid(refunderId, purchase.paid_amount ?? 0)
        : 0;
      const recipients = purchase ? await this.findRewardRecipients(refunderId, purchase.created_at) : [];
      await this.flagUsers([refunderId, ...recipients]);

      console.log("[rainbow-risk] consumable refund processed", {
        transactionId: refund.transactionId, refunderId, purchaseFound: purchase !== null,
        revokedPaid, flaggedRecipients: recipients.length,
      });
    } catch (err) {
      // Claim bırakılır ki RevenueCat yeniden denesin. Kısmi iş tekrarlanırsa en kötü sayaç iki kez
      // düşer — güvenli yön (daha az rainbow); işaretleme zaten tekrarlanabilir.
      const { error: releaseErr } = await supabase.from("iap_transactions").delete().eq("id", claimId);
      if (releaseErr) {
        console.error("[rainbow-risk] refund claim release failed — retry will be skipped", {
          claimId, transactionId: refund.transactionId, error: releaseErr.message,
        });
      }
      throw err;
    }
  }

  /** `refund:<tx>` claim'i: tekrarlanan olay 23505'e takılır (iap_transactions.transaction_id UNIQUE). */
  private async claim(refund: ConsumableRefund): Promise<string | null> {
    const { data, error } = await supabase
      .from("iap_transactions")
      .insert({
        user_id: refund.userId,
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
    if (error?.code === "23503") {
      // Bilinmeyen kullanıcı (FK): yeniden denemek düzeltmez — 4xx/5xx dönüp sonsuz retry'a sokma.
      console.warn("[rainbow-risk] refund for unknown user ignored", {
        userId: refund.userId, transactionId: refund.transactionId,
      });
      return null;
    }
    if (error || !data) throw Errors.SERVER_ERROR();
    return (data as { id: string }).id;
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
      .limit(SPEND_SCAN_LIMIT);
    if (error) throw Errors.SERVER_ERROR();

    const refs = [...new Set(((spends ?? []) as { reference_id: string }[]).map((s) => s.reference_id))];
    const recipients = new Set<string>();
    for (let i = 0; i < refs.length; i += IN_CHUNK) {
      const { data: earned, error: earnedErr } = await supabase
        .from("diamond_transactions")
        .select("user_id")
        .eq("type", "RAINBOW")
        .gt("amount", 0)
        .in("reference_id", refs.slice(i, i + IN_CHUNK))
        .neq("user_id", refunderId);
      if (earnedErr) throw Errors.SERVER_ERROR();
      for (const row of (earned ?? []) as { user_id: string }[]) recipients.add(row.user_id);
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
