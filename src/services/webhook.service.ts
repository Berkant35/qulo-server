import { supabase } from '../config/supabase.js';
import { diamondService } from './diamond.service.js';
import { subscriptionService } from './subscription.service.js';
import {
  IAP_PRODUCT_MAP,
  SUBSCRIPTION_PRODUCT_MAP,
  RCEventType,
  storeProductKey,
} from '../types/index.js';
import { isPaidEligible, webhookPurchaseFacts } from '../utils/paid-eligibility.js';

/** RevenueCat webhook olayı — `rcWebhookSchema.event` ile aynı alanlar. */
export interface RevenueCatWebhookEvent {
  type: string;
  app_user_id: string;
  product_id: string;
  store?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  transaction_id?: string;
  original_transaction_id?: string;
  environment?: string | null;
  period_type?: string | null;
  is_family_share?: boolean | null;
  price?: number | null;
}

class WebhookService {
  async handleRevenueCatEvent(event: RevenueCatWebhookEvent): Promise<void> {
    const {
      type,
      app_user_id: userId,
      product_id: productId,
      store,
      expiration_at_ms,
      transaction_id,
    } = event;

    // Ödenmiş sayılma (rainbow kaynağı): yalnız PRODUCTION, aile paylaşımı değil, abonelikte NORMAL.
    const facts = webhookPurchaseFacts(event);

    const eventType = type as RCEventType;
    const storeType = store === 'APP_STORE' ? 'apple' : 'google';

    // Consumable purchase
    if (eventType === 'NON_RENEWING_PURCHASE') {
      await this.handleConsumablePurchase(
        userId,
        productId,
        storeType,
        transaction_id || '',
        isPaidEligible(facts, 'consumable'),
      );
      return;
    }

    // Subscription events
    const plan = SUBSCRIPTION_PRODUCT_MAP[storeProductKey(productId)];
    if (!plan) return;

    if (!expiration_at_ms) {
      console.error(`[webhook] Missing expiration_at_ms for event ${eventType}, product ${productId}, user ${userId}`);
      return;
    }

    // Idempotency check — skip if we've already processed this (transaction_id, event_type) pair
    if (transaction_id) {
      const { data: existing } = await supabase
        .from('iap_transactions')
        .select('id')
        .eq('transaction_id', transaction_id)
        .eq('rc_event_type', eventType)
        .maybeSingle();

      if (existing) {
        console.log(`[webhook] Skipping duplicate ${eventType} for transaction ${transaction_id}`);
        return;
      }
    }

    const expiresAt = new Date(expiration_at_ms).toISOString();
    const paidEligible = isPaidEligible(facts, 'subscription');

    switch (eventType) {
      case 'INITIAL_PURCHASE':
        await subscriptionService.activateSubscription(
          userId, plan, userId, transaction_id || '', expiresAt, paidEligible
        );
        break;
      case 'RENEWAL':
        await subscriptionService.renewSubscription(
          userId, transaction_id || '', expiresAt, paidEligible
        );
        break;
      case 'CANCELLATION':
        await subscriptionService.cancelSubscription(userId);
        break;
      case 'EXPIRATION':
        await subscriptionService.expireSubscription(userId);
        break;
      case 'PRODUCT_CHANGE':
        await subscriptionService.changeSubscription(
          userId, plan, transaction_id || '', expiresAt, paidEligible
        );
        break;
      case 'UNCANCELLATION':
        await subscriptionService.renewSubscription(
          userId, transaction_id || '', expiresAt, paidEligible
        );
        break;
      default:
        break;
    }

    await this.logIapTransaction(
      userId, productId, storeType, transaction_id || '',
      eventType, null, null
    );
  }

  private async handleConsumablePurchase(
    userId: string,
    productId: string,
    store: string,
    transactionId: string,
    paidEligible: boolean,
  ): Promise<void> {
    const { data: existing } = await supabase
      .from('iap_transactions')
      .select('id')
      .eq('transaction_id', transactionId)
      .single();

    if (existing) return;

    const purpleAmount = IAP_PRODUCT_MAP[storeProductKey(productId)];
    if (!purpleAmount) return;

    // IAP tamamen ödenmiş mor (spec 2026-09-27) — yalnız gerçek satın almada; sandbox/aile paylaşımı 0.
    await diamondService.addPurple(
      userId, purpleAmount, 'IAP_PURCHASE', transactionId, paidEligible ? purpleAmount : 0,
    );

    await this.logIapTransaction(
      userId, productId, store, transactionId,
      'NON_RENEWING_PURCHASE', null, purpleAmount
    );
  }

  private async logIapTransaction(
    userId: string,
    productId: string,
    store: string,
    transactionId: string,
    rcEventType: string,
    amountUsd: number | null,
    purpleCredited: number | null
  ): Promise<void> {
    await supabase.from('iap_transactions').upsert(
      {
        user_id: userId,
        product_id: productId,
        store,
        transaction_id: transactionId || undefined,
        rc_event_type: rcEventType,
        amount_usd: amountUsd,
        purple_credited: purpleCredited,
      },
      { onConflict: 'transaction_id' }
    );
  }
}

export const webhookService = new WebhookService();
