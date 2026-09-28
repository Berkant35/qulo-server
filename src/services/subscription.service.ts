import { supabase } from '../config/supabase.js';
import { diamondService } from './diamond.service.js';
import { economyConfigService } from './economy-config.service.js';
import { Errors } from '../utils/errors.js';
import type {
  SubscriptionPlan,
  SubscriptionInfo,
} from '../types/index.js';

/**
 * Aylık bonusun tekilleştirme anahtarı.
 *
 * Bir satın alma sunucuya İKİ ayrı yoldan gelir: uygulamanın
 * `POST /subscriptions/activate` çağrısı ve RevenueCat webhook'u. İkisi farklı
 * `store_transaction_id` gönderiyor (istemci ISO tarih ya da product_id,
 * webhook mağazanın işlem numarası), bu yüzden işlem numarasına dayalı koruma
 * tutmuyordu ve bonus iki kez yatıyordu (2026-09-05 canlı olayı: 500 yerine
 * 1000 mor elmas). Dönem anahtarı iki yolda da aynı: plan + bitiş tarihi.
 *
 * Tarih NORMALIZE edilmek zorunda: iki yol aynı anı farklı ISO gösterimiyle
 * yolluyor — istemci yolu RevenueCat'in ham string'ini (`...:58Z`), webhook ise
 * `new Date(expiration_at_ms).toISOString()` (`...:58.000Z`). Ham hâlde
 * birleştirilirse anahtarlar tutmaz ve bonus yine iki kez yatar.
 */
function subscriptionPeriodRef(plan: SubscriptionPlan, expiresAt: string): string {
  const ms = Date.parse(expiresAt);
  const normalized = Number.isNaN(ms) ? expiresAt : new Date(ms).toISOString();
  return `sub_${plan}_${normalized}`;
}

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
    expiresAt: string,
    paidEligible = false,
  ): Promise<void> {
    // Aynı dönem için zaten aktif bir kayıt varsa yeni satır AÇMA — iki giriş
    // yolu (istemci + webhook) aynı satın almayı saniyeler arayla bildiriyor.
    // limit(1): geçmişte mükerrer satır oluştuysa maybeSingle çok-satır hatası
    // verip null döndürür ve kod mükerrerliği çoğaltarak insert'e düşerdi.
    const { data: existingRows, error: lookupError } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('expires_at', expiresAt)
      .eq('status', 'active')
      .limit(1);

    if (lookupError) {
      // Bilinçli olarak fırlatmıyoruz: kullanıcı ödemesini yaptı, isteği
      // patlatmak kötü olur. Mükerrer satır riski kalır ama paranın koruması
      // bağımsız: bonus dönem anahtarıyla tekilleşiyor (addPurple guard).
      console.error('[subscription] active period lookup failed:', lookupError.message);
    }
    const existing = existingRows?.[0];

    if (existing) {
      await supabase
        .from('user_subscriptions')
        .update({
          plan,
          rc_customer_id: rcCustomerId,
          store_transaction_id: storeTransactionId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      // Yeni dönem öncekinin yerini alır (yükseltme: istemci yeni ürünü bildirir, eski satır
      // açık kalırsa sonraki RENEWAL onu da yeni plana/süreye çekerdi).
      const { error: supersedeError } = await supabase
        .from('user_subscriptions')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('status', 'active');
      if (supersedeError) {
        // Fırlatılmaz (yukarıdaki gerekçe): erişimin kaynağı `users`; eski satır açık kalır.
        console.error('[subscription] previous period close failed:', supersedeError.message);
      }

      await supabase.from('user_subscriptions').insert({
        user_id: userId,
        plan,
        status: 'active',
        rc_customer_id: rcCustomerId,
        store_transaction_id: storeTransactionId,
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
      });
    }

    await supabase
      .from('users')
      .update({
        subscription_plan: plan,
        subscription_expires_at: expiresAt,
        rc_customer_id: rcCustomerId,
      })
      .eq('id', userId);

    await this.grantMonthlyBonus(userId, plan, expiresAt, paidEligible);
  }

  /**
   * Plan olayın ürününden gelir, kullanıcının kayıtlı planından DEĞİL: Apple yükseltmesi yürürlüğe
   * girince RENEWAL yeni ürünle gelir; kayıtlı plan eski ürünü gösterir.
   */
  async renewSubscription(
    userId: string,
    plan: SubscriptionPlan,
    storeTransactionId: string,
    expiresAt: string,
    paidEligible = false,
  ): Promise<void> {
    await supabase
      .from('user_subscriptions')
      .update({
        plan,
        status: 'active',
        expires_at: expiresAt,
        store_transaction_id: storeTransactionId,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('status', 'active');

    await supabase
      .from('users')
      .update({ subscription_plan: plan, subscription_expires_at: expiresAt })
      .eq('id', userId);

    await this.grantMonthlyBonus(userId, plan, expiresAt, paidEligible);
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

  /**
   * Otomatik yenileme yeniden açıldı: dönem değişmez, yalnız iptal edilmiş GÜNCEL satır aktifleşir.
   * Bonus yok — dönemin bonusu satın almada/yenilemede verildi.
   */
  async uncancelSubscription(userId: string): Promise<void> {
    await supabase
      .from('user_subscriptions')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gt('expires_at', new Date().toISOString());
  }

  /**
   * Biten ürünün satırlarını kapatır ve erişimi kaldırır. Webhook yolunda erişim hemen ardından
   * mağaza durumundan yeniden yazılır (`applyStoreState`): Google yükseltmesinde eski ürünün
   * EXPIRATION'ı gelse de yeni ürün aktifse erişim geri gelir. `plan` verilirse yalnız o planın
   * satırları kapanır (yeni ürünün satırı açık kalır).
   */
  async expireSubscription(userId: string, plan?: SubscriptionPlan): Promise<void> {
    let rows = supabase
      .from('user_subscriptions')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .in('status', ['active', 'cancelled']);
    if (plan) rows = rows.eq('plan', plan);
    await rows;

    await supabase
      .from('users')
      .update({
        subscription_plan: null,
        subscription_expires_at: null,
      })
      .eq('id', userId);
  }

  /**
   * Erişimin mağazadaki doğrusu (RevenueCat GET /subscribers) — webhook olay alanlarından kurulan
   * durumu ezer. Olay sırası garanti değil ve PRODUCT_CHANGE/iade/yükseltme modlarında olay
   * alanları erişimi yanlış anlatıyor (2026-09-28 olayı). Hata fırlatılır: RevenueCat yeniden dener.
   */
  async applyStoreState(
    userId: string,
    state: { plan: SubscriptionPlan; expiresAt: string } | null,
  ): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({
        subscription_plan: state?.plan ?? null,
        subscription_expires_at: state?.expiresAt ?? null,
      })
      .eq('id', userId);
    if (error) {
      console.error('[subscription] store state write failed:', error.message);
      throw Errors.SERVER_ERROR();
    }
  }

  /**
   * Aylık mor bonusu — dönem anahtarıyla tekilleşir (bkz. subscriptionPeriodRef). Abonelik moru
   * "yarı ödenmiş": tier payı kadarı rainbow üretebilir (economy rainbow bloğu), ama YALNIZ gerçek,
   * tam fiyatlı, kendi satın almasında (`paidEligible`, utils/paid-eligibility). Aksi hâlde bonus
   * yine tam yatar, ödenmiş payı 0.
   */
  private async grantMonthlyBonus(
    userId: string,
    plan: SubscriptionPlan,
    expiresAt: string,
    paidEligible: boolean,
  ): Promise<void> {
    const config = await economyConfigService.getConfig();
    const bonus = config.subscriptionLimits[plan].monthlyPurpleBonus;
    if (bonus <= 0) return;

    const paid = paidEligible ? Math.floor(bonus * config.rainbow.subscriptionPaidShare[plan]) : 0;
    await diamondService.addPurple(
      userId,
      bonus,
      'SUBSCRIPTION_BONUS',
      subscriptionPeriodRef(plan, expiresAt),
      paid,
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
