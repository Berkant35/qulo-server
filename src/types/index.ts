export interface JwtPayload {
  userId: string;
  email: string;
}

export type PowerName =
  | "ORACLE"
  | "HALF"
  | "SKIP"
  | "SKIP_ALL"
  | "TIME_EXTEND"
  | "HINT"
  | "POWER_BLOCK"
  | "POWER_UNBLOCK";

// Chat question power sets (which powers are available per option count)
export const CHAT_QUESTION_POWERS_2: PowerName[] = ["ORACLE", "SKIP"];
export const CHAT_QUESTION_POWERS_4: PowerName[] = ["ORACLE", "SKIP", "HALF", "HINT", "TIME_EXTEND"];

// Subscription Plans
export type SubscriptionPlan = 'plus' | 'premium';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface SubscriptionInfo {
  plan: SubscriptionPlan | null;
  status: SubscriptionStatus | null;
  expiresAt: string | null;
  isActive: boolean;
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

// Subscription product IDs
export const SUBSCRIPTION_PRODUCT_MAP: Record<string, SubscriptionPlan> = {
  quloplusmonthly2: 'plus',
  qulopremiummonthly: 'premium',
};

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
  created_at: string;
  reward_locked: boolean;
}

export interface AnswerQuestionResult {
  question: ChatQuestionBase;
  is_correct: boolean;
  unmatched: boolean;
  skipped?: boolean;
  rescued?: boolean;
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
