import { supabase } from '../config/supabase.js';
import { diamondService } from './diamond.service.js';
import { subscriptionService } from './subscription.service.js';
import {
  IAP_PRODUCT_MAP,
  SUBSCRIPTION_PRODUCT_MAP,
  RCEventType,
} from '../types/index.js';

class WebhookService {
  async handleRevenueCatEvent(event: {
    type: string;
    app_user_id: string;
    product_id: string;
    store?: string;
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    transaction_id?: string;
    original_transaction_id?: string;
  }): Promise<void> {
    const {
      type,
      app_user_id: userId,
      product_id: productId,
      store,
      expiration_at_ms,
      transaction_id,
    } = event;

    const eventType = type as RCEventType;
    const storeType = store === 'APP_STORE' ? 'apple' : 'google';

    // Consumable purchase
    if (eventType === 'NON_RENEWING_PURCHASE') {
      await this.handleConsumablePurchase(
        userId,
        productId,
        storeType,
        transaction_id || ''
      );
      return;
    }

    // Subscription events
    const plan = SUBSCRIPTION_PRODUCT_MAP[productId];
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

    switch (eventType) {
      case 'INITIAL_PURCHASE':
        await subscriptionService.activateSubscription(
          userId, plan, userId, transaction_id || '', expiresAt
        );
        break;
      case 'RENEWAL':
        await subscriptionService.renewSubscription(
          userId, transaction_id || '', expiresAt
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
          userId, plan, transaction_id || '', expiresAt
        );
        break;
      case 'UNCANCELLATION':
        await subscriptionService.renewSubscription(
          userId, transaction_id || '', expiresAt
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
    transactionId: string
  ): Promise<void> {
    const { data: existing } = await supabase
      .from('iap_transactions')
      .select('id')
      .eq('transaction_id', transactionId)
      .single();

    if (existing) return;

    const purpleAmount = IAP_PRODUCT_MAP[productId];
    if (!purpleAmount) return;

    await diamondService.addPurple(userId, purpleAmount, 'IAP_PURCHASE', transactionId);

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
