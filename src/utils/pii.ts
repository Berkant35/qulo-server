/**
 * PII masking helpers for log output.
 * Prevents GDPR/KVKK-sensitive data from leaking into log retention systems.
 */

/**
 * Mask an email address for logging: "berkant@example.com" → "be***@example.com"
 */
export function maskEmail(email: string): string {
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}
