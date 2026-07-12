// Hesap silme nedeni canonical kodları (churn taksonomisi).
// Spec: docs/superpowers/specs/2026-06-27-account-deletion-reasons-design.md
// reason_code DB'de saklanır (çevrilmiş string DEĞİL). UI etiketleri mobile l10n'da.

export const DELETION_REASON_CODES = [
  "found_someone",
  "few_matches",
  "few_users_nearby",
  "app_confusing",
  "technical_issues",
  "privacy_concerns",
  "too_expensive",
  "taking_a_break",
  "other",
  "skipped",
] as const;

export type DeletionReasonCode = (typeof DELETION_REASON_CODES)[number];

export function isKnownReasonCode(code: string): code is DeletionReasonCode {
  return (DELETION_REASON_CODES as readonly string[]).includes(code);
}

// Churn tipi sınıflandırması (spec Bölüm 4-E) — raporlama/analiz tek kaynağı.
export type ChurnType = "positive" | "negative" | "neutral";

export const REASON_CHURN_TYPES: Record<DeletionReasonCode, ChurnType> = {
  found_someone: "positive",
  few_matches: "negative",
  few_users_nearby: "negative",
  app_confusing: "negative",
  technical_issues: "negative",
  privacy_concerns: "negative",
  too_expensive: "negative",
  taking_a_break: "neutral",
  other: "neutral",
  skipped: "neutral",
};

// Retention (win-back) teklifi SADECE bu nedenlerde gösterilir (adreslenebilir negatif churn).
// found_someone (pozitif), privacy_concerns/technical_issues (PD çözmez), other/skipped (belirsiz) hariç.
export const RETENTION_ELIGIBLE_REASONS = [
  "few_matches",
  "few_users_nearby",
  "app_confusing",
  "too_expensive",
  "taking_a_break",
] as const;

// Retention grant'ı diamond_transactions'a bu reason ile yazılır (once-per-user guard anahtarı).
export const RETENTION_BONUS_REASON = "RETENTION_BONUS";

export function isRetentionEligibleReason(code: string): boolean {
  return (RETENTION_ELIGIBLE_REASONS as readonly string[]).includes(code);
}
