import { env } from '../config/env.js';

interface RCSubscription {
  expires_date: string | null;
  purchase_date: string;
  product_identifier: string;
  is_sandbox: boolean;
}

interface RCNonSubscription {
  id: string;
  purchase_date: string;
  product_identifier: string;
  is_sandbox: boolean;
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
  ): Promise<{ valid: boolean; error?: string }> {
    if (!env.REVENUECAT_API_KEY) {
      // Development mode: skip validation if no key
      if (env.NODE_ENV === 'development') return { valid: true };
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
      }

      return { valid: true };
    } catch (err) {
      console.error('[RevenueCat] Verification error:', err);
      return { valid: false, error: 'Verification service unavailable' };
    }
  }

  /**
   * Verify a subscription purchase and return expiration date.
   */
  async verifySubscription(
    userId: string,
    productId: string,
  ): Promise<{ valid: boolean; expiresAt?: string; error?: string }> {
    if (!env.REVENUECAT_API_KEY) {
      if (env.NODE_ENV === 'development') {
        // Dev mode: hardcoded 30 days
        return {
          valid: true,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }
      return { valid: false, error: 'IAP validation not configured' };
    }

    try {
      const subscriber = await this.getSubscriber(userId);
      if (!subscriber) return { valid: false, error: 'Subscriber not found' };

      const subscription = subscriber.subscriptions[productId];
      if (!subscription) {
        return { valid: false, error: 'Subscription not found for this product' };
      }

      // Check if subscription is still active
      if (subscription.expires_date) {
        const expiresAt = new Date(subscription.expires_date);
        if (expiresAt < new Date()) {
          return { valid: false, error: 'Subscription has expired' };
        }
        return { valid: true, expiresAt: subscription.expires_date };
      }

      // Lifetime subscription (no expiry)
      return { valid: true };
    } catch (err) {
      console.error('[RevenueCat] Subscription verification error:', err);
      return { valid: false, error: 'Verification service unavailable' };
    }
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
