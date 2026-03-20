import { supabase } from '../config/supabase.js';
import { diamondService } from './diamond.service.js';
import { economyConfigService } from './economy-config.service.js';
import { Errors } from '../utils/errors.js';
import type {
  SubscriptionPlan,
  SubscriptionInfo,
} from '../types/index.js';

class SubscriptionService {
  async getStatus(userId: string): Promise<SubscriptionInfo> {
    const { data: user, error } = await supabase
      .from('users')
      .select('subscription_plan, subscription_expires_at')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return { plan: null, status: null, expiresAt: null, isActive: false };
    }

    const plan = user.subscription_plan as SubscriptionPlan | null;
    const expiresAt = user.subscription_expires_at;

    if (!plan || !expiresAt) {
      return { plan: null, status: null, expiresAt: null, isActive: false };
    }

    const isActive = new Date(expiresAt) > new Date();
    return {
      plan,
      status: isActive ? 'active' : 'expired',
      expiresAt,
      isActive,
    };
  }

  async activateSubscription(
    userId: string,
    plan: SubscriptionPlan,
    rcCustomerId: string,
    storeTransactionId: string,
    expiresAt: string
  ): Promise<void> {
    await supabase.from('user_subscriptions').insert({
      user_id: userId,
      plan,
      status: 'active',
      rc_customer_id: rcCustomerId,
      store_transaction_id: storeTransactionId,
      started_at: new Date().toISOString(),
      expires_at: expiresAt,
    });

    await supabase
      .from('users')
      .update({
        subscription_plan: plan,
        subscription_expires_at: expiresAt,
        rc_customer_id: rcCustomerId,
      })
      .eq('id', userId);

    const config = await economyConfigService.getConfig();
    const bonus = config.subscriptionLimits[plan].monthlyPurpleBonus;
    if (bonus > 0) {
      await diamondService.addPurple(
        userId,
        bonus,
        'SUBSCRIPTION_BONUS',
        storeTransactionId
      );
    }
  }

  async renewSubscription(
    userId: string,
    storeTransactionId: string,
    expiresAt: string
  ): Promise<void> {
    const { data: user } = await supabase
      .from('users')
      .select('subscription_plan')
      .eq('id', userId)
      .single();

    const plan = (user?.subscription_plan as SubscriptionPlan) || 'plus';

    await supabase
      .from('user_subscriptions')
      .update({
        status: 'active',
        expires_at: expiresAt,
        store_transaction_id: storeTransactionId,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active');

    await supabase
      .from('users')
      .update({ subscription_expires_at: expiresAt })
      .eq('id', userId);

    const config = await economyConfigService.getConfig();
    const bonus = config.subscriptionLimits[plan].monthlyPurpleBonus;
    if (bonus > 0) {
      await diamondService.addPurple(
        userId,
        bonus,
        'SUBSCRIPTION_BONUS',
        storeTransactionId
      );
    }
  }

  async cancelSubscription(userId: string): Promise<void> {
    await supabase
      .from('user_subscriptions')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active');
  }

  async expireSubscription(userId: string): Promise<void> {
    await supabase
      .from('user_subscriptions')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active');

    await supabase
      .from('users')
      .update({
        subscription_plan: null,
        subscription_expires_at: null,
      })
      .eq('id', userId);
  }

  async changeSubscription(
    userId: string,
    newPlan: SubscriptionPlan,
    storeTransactionId: string,
    expiresAt: string
  ): Promise<void> {
    await this.expireSubscription(userId);

    const { data: user } = await supabase
      .from('users')
      .select('rc_customer_id')
      .eq('id', userId)
      .single();

    await this.activateSubscription(
      userId,
      newPlan,
      user?.rc_customer_id || '',
      storeTransactionId,
      expiresAt
    );
  }

  async getDailyStats(userId: string) {
    const { data: user, error } = await supabase
      .from('users')
      .select('daily_swipes_used, daily_swipes_reset_at, daily_undos_used, subscription_plan, subscription_expires_at')
      .eq('id', userId)
      .single();

    if (error || !user) throw Errors.USER_NOT_FOUND();

    // Lazy reset: if reset_at is before today UTC midnight
    const now = new Date();
    const resetAt = user.daily_swipes_reset_at ? new Date(user.daily_swipes_reset_at) : new Date(0);
    const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    let dailySwipesUsed = user.daily_swipes_used ?? 0;
    let dailyUndosUsed = user.daily_undos_used ?? 0;

    if (resetAt < todayMidnight) {
      await supabase
        .from('users')
        .update({
          daily_swipes_used: 0,
          daily_undos_used: 0,
          daily_swipes_reset_at: now.toISOString(),
        })
        .eq('id', userId);

      dailySwipesUsed = 0;
      dailyUndosUsed = 0;
    }

    const plan = user.subscription_plan as SubscriptionPlan | null;
    const isActive = user.subscription_expires_at
      ? new Date(user.subscription_expires_at) > now
      : false;
    const effectivePlan = isActive ? (plan || 'free') : 'free';
    const config = await economyConfigService.getConfig();
    const limits = config.subscriptionLimits[effectivePlan];

    const { count: questionsCreated } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    const UNLIMITED_THRESHOLD = 999999;
    return {
      dailyDiscoversUsed: dailySwipesUsed,
      dailyDiscoversLimit: limits.dailyDiscovers >= UNLIMITED_THRESHOLD ? -1 : limits.dailyDiscovers,
      dailyUndosUsed: dailyUndosUsed,
      dailyUndosLimit: limits.dailyUndos >= UNLIMITED_THRESHOLD ? -1 : limits.dailyUndos,
      questionsCreated: questionsCreated ?? 0,
      questionsLimit: limits.maxQuestions,
      monthlyPurpleBonus: limits.monthlyPurpleBonus,
      passportMode: limits.passportMode,
      hasAds: limits.hasAds,
    };
  }

  async incrementDailySwipes(userId: string): Promise<void> {
    const stats = await this.getDailyStats(userId);
    if (stats.dailyDiscoversLimit !== -1 && stats.dailyDiscoversUsed >= stats.dailyDiscoversLimit) {
      throw Errors.DAILY_LIMIT_EXCEEDED('discover');
    }
    await supabase
      .from('users')
      .update({ daily_swipes_used: stats.dailyDiscoversUsed + 1 })
      .eq('id', userId);
  }

  async incrementDailyUndos(userId: string): Promise<void> {
    const stats = await this.getDailyStats(userId);
    if (stats.dailyUndosLimit !== -1 && stats.dailyUndosUsed >= stats.dailyUndosLimit) {
      throw Errors.DAILY_LIMIT_EXCEEDED('undo');
    }
    await supabase
      .from('users')
      .update({ daily_undos_used: stats.dailyUndosUsed + 1 })
      .eq('id', userId);
  }

  async getLimits(plan: SubscriptionPlan | null) {
    const config = await economyConfigService.getConfig();
    return config.subscriptionLimits[plan || 'free'];
  }
}

export const subscriptionService = new SubscriptionService();
