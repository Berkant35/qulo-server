import { env } from '../config/env.js';
import { isPaidEligible, subscriberSubscriptionFacts } from '../utils/paid-eligibility.js';

/** API v1 `subscriber.subscriptions[productId]` (docs: api-v1/customer-info-model). */
interface RCSubscription {
  expires_date: string | null;
  purchase_date: string;
  product_identifier: string;
  is_sandbox?: boolean;
  /** "normal" | "trial" | "intro" | "promotional" | "prepaid" (küçük harf). */
  period_type?: string;
  /** "PURCHASED" | "FAMILY_SHARED". */
  ownership_type?: string;
}

interface RCNonSubscription {
  id: string;
  purchase_date: string;
  product_identifier: string;
  is_sandbox?: boolean;
}

export interface PurchaseVerification {
  valid: boolean;
  transactionId?: string;
  isSandbox?: boolean;
  /** Ödenmiş mor sayılır mı (utils/paid-eligibility). Yalnız RevenueCat'in doğruladığı gerçek alım. */
  paidEligible?: boolean;
  error?: string;
}

export interface SubscriptionVerification {
  valid: boolean;
  expiresAt?: string;
  isSandbox?: boolean;
  periodType?: string;
  ownershipType?: string;
  /** Aylık bonusun tier payı ödenmiş sayılır mı (utils/paid-eligibility). */
  paidEligible?: boolean;
  error?: string;
}

interface RCSubscriberResponse {
  subscriber: {
    subscriptions: Record<string, RCSubscription>;
    non_subscriptions: Record<string, RCNonSubscription[]>;
  };
}

class RevenueCatService {
  private readonly baseUrl = 'https://api.revenuecat.com/v1';

  /**
   * Verify a consumable (diamond) purchase exists in RevenueCat.
   * Returns the purchase if valid, null if not found.
   */
  async verifyPurchase(
    userId: string,
    productId: string,
    transactionId?: string,
  ): Promise<PurchaseVerification> {
    if (env.IAP_SKIP_VALIDATION === 'true') return { valid: true };
    if (!env.REVENUECAT_API_KEY) {
      return { valid: false, error: 'IAP validation not configured' };
    }

    try {
      const subscriber = await this.getSubscriber(userId);
      if (!subscriber) return { valid: false, error: 'Subscriber not found' };

      // Check non_subscriptions (consumable purchases like diamonds)
      const purchases = subscriber.non_subscriptions[productId];
      if (!purchases || purchases.length === 0) {
        return { valid: false, error: 'Purchase not found for this product' };
      }

      // If transactionId provided, verify it matches
      if (transactionId) {
        const match = purchases.find((p) => p.id === transactionId);
        if (!match) return { valid: false, error: 'Transaction ID not found' };
        return this.verifiedPurchase(match);
      }

      // İstemci işlem numarası göndermediyse (RevenueCat listesi henüz senkron
      // olmamış olabilir — mobilde `lastOrNull` null dönebiliyor) YETKİLİ
      // numarayı buradan türetiyoruz. Tekilleştirme anahtarı istemciye
      // bırakılamaz: alanı boş göndermek anahtarı değiştirip aynı satın almanın
      // ikinci kez kredilendirilmesine izin veriyordu.
      const latest = purchases.reduce((a, b) =>
        Date.parse(b.purchase_date) >= Date.parse(a.purchase_date) ? b : a,
      );
      return this.verifiedPurchase(latest);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[RevenueCat] Verification error:', errorMsg);
      return { valid: false, error: 'Verification service unavailable' };
    }
  }

  /**
   * Verify a subscription purchase and return expiration date.
   */
  async verifySubscription(
    userId: string,
    productId: string,
  ): Promise<SubscriptionVerification> {
    if (env.IAP_SKIP_VALIDATION === 'true') {
      return {
        valid: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    if (!env.REVENUECAT_API_KEY) {
      return { valid: false, error: 'IAP validation not configured' };
    }

    try {
      const subscriber = await this.getSubscriber(userId);
      if (!subscriber) return { valid: false, error: 'Subscriber not found' };

      const subscription = subscriber.subscriptions[productId];
      if (!subscription) {
        return { valid: false, error: 'Subscription not found for this product' };
      }

      // Ödenmiş uygunluğu: yalnız PRODUCTION + kendi satın alması + normal dönem (eksik alan = hayır).
      const facts = {
        isSandbox: subscription.is_sandbox,
        periodType: subscription.period_type,
        ownershipType: subscription.ownership_type,
      };
      const paidEligible = isPaidEligible(subscriberSubscriptionFacts(facts), 'subscription');

      // Check if subscription is still active
      if (subscription.expires_date) {
        const expiresAt = new Date(subscription.expires_date);
        if (expiresAt < new Date()) {
          return { valid: false, error: 'Subscription has expired' };
        }
        return { valid: true, expiresAt: subscription.expires_date, ...facts, paidEligible };
      }

      // Lifetime subscription (no expiry)
      return { valid: true, ...facts, paidEligible };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[RevenueCat] Subscription verification error:', errorMsg);
      return { valid: false, error: 'Verification service unavailable' };
    }
  }

  /**
   * Doğrulanmış tüketilebilir alım. Tüketilebilir ürün aile paylaşımına açık değil (API v1
   * non_subscriptions girdisinde ownership alanı da yok) — uygunluğu yalnız ortam belirler.
   */
  private verifiedPurchase(purchase: RCNonSubscription): PurchaseVerification {
    const sandbox = purchase.is_sandbox;
    return {
      valid: true,
      transactionId: purchase.id,
      isSandbox: sandbox,
      paidEligible: isPaidEligible({ sandbox, familyShared: false }, 'consumable'),
    };
  }

  private async getSubscriber(userId: string): Promise<RCSubscriberResponse['subscriber'] | null> {
    const response = await fetch(`${this.baseUrl}/subscribers/${userId}`, {
      headers: {
        'Authorization': `Bearer ${env.REVENUECAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`RevenueCat API error: ${response.status}`);
    }

    const data = (await response.json()) as RCSubscriberResponse;
    return data.subscriber;
  }
}

export const revenueCatService = new RevenueCatService();
