/**
 * AdMob SSV doğrulayıcı açık anahtarları (ECDSA P-256).
 * Kaynak: https://developers.google.com/admob/android/rewarded-video-ssv (2026-11-18) —
 * anahtarlar https://www.gstatic.com/admob/reward/verifier-keys.json adresinde, `key_id` ile seçilir,
 * en çok 24 saat önbelleğe alınır; rotasyonda `key_id` önbellekte yoksa yenilenir.
 */

export const ADMOB_VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

/** Önbellek ömrü: Google en çok 24 sa diyor, güvenli pay için 12 sa. */
const KEY_TTL_MS = 12 * 60 * 60 * 1000;
/** Bilinmeyen key_id ile zorla yenilemeler arası en az süre (sahte key_id ile gstatic'e yüklenmeyi engeller). */
const FORCED_REFRESH_MIN_GAP_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** key_id -> PEM açık anahtar. `null`: anahtar yok (imza geçersiz sayılır). */
export type VerifierKeyProvider = (keyId: string) => Promise<string | null>;

interface VerifierKeysPayload {
  keys?: Array<{ keyId?: number | string; pem?: string }>;
}

export function createGoogleKeyProvider(
  fetchJson: () => Promise<VerifierKeysPayload> = defaultFetchKeys,
  now: () => number = Date.now,
): VerifierKeyProvider {
  let keys = new Map<string, string>();
  let fetchedAt = 0;
  let lastForcedAt = 0;

  async function refresh(): Promise<void> {
    const payload = await fetchJson();
    const next = new Map<string, string>();
    for (const k of payload.keys ?? []) {
      if (k.keyId !== undefined && typeof k.pem === "string") next.set(String(k.keyId), k.pem);
    }
    if (next.size === 0) throw new Error("verifier keys empty");
    keys = next;
    fetchedAt = now();
  }

  return async (keyId) => {
    const t = now();
    if (keys.size === 0 || t - fetchedAt > KEY_TTL_MS) {
      await refresh(); // ilk yükleme / süre doldu: hata yukarı (çağıran 500 → Google yeniden dener)
    } else if (!keys.has(keyId) && t - lastForcedAt > FORCED_REFRESH_MIN_GAP_MS) {
      lastForcedAt = t;
      await refresh(); // rotasyon: yeni key_id geldi
    }
    return keys.get(keyId) ?? null;
  };
}

async function defaultFetchKeys(): Promise<VerifierKeysPayload> {
  const res = await fetch(ADMOB_VERIFIER_KEYS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`verifier keys HTTP ${res.status}`);
  return (await res.json()) as VerifierKeysPayload;
}

export const googleKeyProvider: VerifierKeyProvider = createGoogleKeyProvider();
