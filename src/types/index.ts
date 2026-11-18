export interface JwtPayload {
  userId: string;
  email: string;
}

// Tek kaynak: economy-config.schema.ts (powerCosts anahtarlarından türetilir).
import type { PowerName } from "./economy-config.schema.js";
export type { PowerName };

// Chat question power sets (which powers are available per option count)
export const CHAT_QUESTION_POWERS_2: PowerName[] = ["ORACLE", "SKIP"];
export const CHAT_QUESTION_POWERS_4: PowerName[] = ["ORACLE", "SKIP", "HALF", "HINT", "TIME_EXTEND"];

// Subscription Plans
export type SubscriptionPlan = 'plus' | 'premium';
/** Donem plandan AYRI: plan hak setini, donem faturalama araligini ve bonus miktarini belirler. */
export type SubscriptionPeriod = 'weekly' | 'monthly';

/**
 * Plus Haftalik magaza kimligi. iOS ve Android AYRI anahtar: Premium'da kimlikler magazaya gore
 * ayrisabildi (bkz. SUBSCRIPTION_PRODUCT_MAP); simdilik ikisi ayni ama tek yere bagli degil.
 */
export const SUBSCRIPTION_WEEKLY_PRODUCT_IDS = {
  ios: 'quloplusweekly',
  android: 'quloplusweekly',
} as const;
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface SubscriptionInfo {
  plan: SubscriptionPlan | null;
  status: SubscriptionStatus | null;
  expiresAt: string | null;
  isActive: boolean;
  /** Faturalama donemi; aktif plan yoksa null. Donem kaydi olmayan eski abonelikler 'monthly'. */
  period: SubscriptionPeriod | null;
}

// RevenueCat webhook event types
export type RCEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'NON_RENEWING_PURCHASE';

// IAP Product mapping (store_id → purple amount)
export const IAP_PRODUCT_MAP: Record<string, number> = {
  qulopurple50: 50,
  qulopurple150: 150,
  qulopurple400: 400,
  qulopurple1000: 1000,
  qulopurple2500: 2500,
  qulopurple6000: 6000,
};

// Subscription product IDs — magaza kimlikleri (storeProductKey ile normalize edilmis).
// Premium'un kimligi magazaya gore FARKLI: App Store `qulopremiummonthly2`,
// Google Play `qulopremiummonthly` (Play API 2026-09-15: base plan qulopremium-monthly).
export const SUBSCRIPTION_PRODUCT_MAP: Record<string, SubscriptionPlan> = {
  quloplusmonthly2: 'plus',
  qulopremiummonthly2: 'premium',
  qulopremiummonthly: 'premium',
  // Haftalik Plus (2.2.0, K1): plan 'plus' kalir — haklar/limitler Plus ile ayni kaynaktan.
  // Set: iOS/Android kimlikleri aynıyken tekrarlı anahtar olmaz, ayrışırsa ikisi de eşlenir.
  ...Object.fromEntries([...new Set(Object.values(SUBSCRIPTION_WEEKLY_PRODUCT_IDS))].map((id) => [id, 'plus' as const])),
};

/** Haritada olmayan her abonelik urunu aylik sayilir (mevcut urunlerin hepsi aylik). */
const WEEKLY_PRODUCT_KEYS: ReadonlySet<string> = new Set(Object.values(SUBSCRIPTION_WEEKLY_PRODUCT_IDS));

/**
 * RevenueCat, Google Play'in base-plan'li aboneliklerini `urun:basePlan`
 * (orn. `quloplusmonthly2:quloplus-monthly`) ve tek seferlik urunleri
 * `urun:satinAlmaSecenegi` olarak gonderebilir; haritalar yalin urun kimligiyle
 * calisir. Hem webhook hem dogrudan dogrulama ucu ayni anahtari kullanir.
 */
export const storeProductKey = (productId: string): string => productId.split(':')[0];

export const subscriptionPeriodOf = (productId: string): SubscriptionPeriod =>
  WEEKLY_PRODUCT_KEYS.has(storeProductKey(productId)) ? 'weekly' : 'monthly';

/* ── Chat Question Response Types ─────────────────────────────────────── */
export interface ChatQuestionBase {
  id: string;
  match_id: string;
  sender_id: string;
  question_text: string;
  option_count: number;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option: string;
  hint_text: string | null;
  has_unmatch_risk: boolean;
  has_chat_lock: boolean;
  has_power_block: boolean;
  power_block_removed: boolean;
  time_limit_seconds: number;
  answered_option: string | null;
  is_correct: boolean | null;
  answered_at: string | null;
  time_spent: number | null;
  powers_used: string[];
  /** HALF'in eledigi siklar (kalici). ORACLE bunlari onermez; istemci reload'da hidre eder. */
  eliminated_options: string[] | null;
  /** ORACLE'in onerdigi sik (kalici). HALF bunu elemez; istemci reload'da hidre eder. */
  oracle_suggested_option: string | null;
  created_at: string;
  reward_locked: boolean;
  is_abandoned: boolean;
}

export interface AnswerQuestionResult {
  question: ChatQuestionBase;
  is_correct: boolean;
  unmatched: boolean;
  skipped?: boolean;
  rescued?: boolean;
  green_reward?: number;
  /** Ödülün ödenmiş mordan gelen payı (spec 2026-09-27); yoksa 0/undefined. */
  rainbow_reward?: number;
  powers_used?: string[];
  correct_option?: string;
  answered_option?: string | null;
  time_spent?: number | null;
  is_abandoned: boolean;
}

export interface UsePowerResult {
  power_name?: string;
  power_result?: Record<string, any>;
  suggested_option?: string;
  eliminated_options?: string[];
  hint_text?: string | null;
  extra_seconds?: number;
  cost?: number;
  green_reward?: number;
  /** Ödülün ödenmiş mordan gelen payı (spec 2026-09-27); yoksa 0/undefined. */
  rainbow_reward?: number;
  is_correct?: boolean;
  question?: ChatQuestionBase;
  skipped?: boolean;
  unblocked?: boolean;
}

export interface HandleTimeoutResult {
  can_rescue: boolean;
  has_power_block: boolean;
}

export interface ChatQuestionHistory {
  id: string;
  question_text: string;
  option_count: number;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option: string;
  time_limit_seconds: number;
  hint_text: string | null;
  has_unmatch_risk: boolean;
  has_chat_lock: boolean;
  created_at: string;
}

export interface HistoryResponse {
  items: ChatQuestionHistory[];
  total: number;
  page: number;
  limit: number;
}
