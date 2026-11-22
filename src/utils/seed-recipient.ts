/**
 * Seed (test) profillerine e-posta gitmez. Adresleri `seed-<prefix>_NNNN@qulo.seed` — var olmayan alan adı:
 * gönderim geri döner (bounce), Gmail gönderici itibarını düşürür. Seed satırlarında `email_verified=true` ve
 * `email_notifications_enabled=true` (basma betiği böyle yazar) olduğu için tercih/doğrulama kapıları onları ELEMEZ.
 * İki işaretten biri yeter: bayrak (`is_seed_profile`) ya da alan adı (bayrağı elle düşürülmüş satır).
 */
export const SEED_EMAIL_DOMAIN = "@qulo.seed";

export function isSeedRecipient(row: { is_seed_profile?: boolean | null; email?: string | null }): boolean {
  if (row.is_seed_profile === true) return true;
  return typeof row.email === "string" && row.email.toLowerCase().endsWith(SEED_EMAIL_DOMAIN);
}
