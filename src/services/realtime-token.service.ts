import { createPrivateKey, type JsonWebKey, type KeyObject } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { Errors } from "../utils/errors.js";

/**
 * Supabase Realtime için kullanıcı başına kısa ömürlü JWT.
 *
 * Uygulama Supabase Auth kullanmıyor; mobil Realtime'a publishable/anon anahtarla bağlanıyor.
 * Bu yüzden `matches`/`messages` RLS'i kapalı ve anon SELECT açık kalmıştı (051–053, 2026-09-11).
 * Sunucu bu token'ı `role=authenticated`, `sub=<users.id>` ile imzalar. Mobil `realtime.setAuth(token)`
 * çağırır. Sonra 082/083 policy'leri `auth.uid()` ile yalnız katılımcıya teslimat yapar.
 *
 * İmzalayıcı seçimi (ikisi birden tanımlıysa ES256 kazanır):
 * - `SUPABASE_JWT_PRIVATE_JWK`: projeye içe aktarılıp "current" yapılmış ES256 özel anahtarı (JWK JSON, `kid` zorunlu).
 *   Supabase'in önerdiği yol. Standby anahtarla imzalanan token kabul EDİLMEZ, önce "Rotate keys" gerekir.
 * - `SUPABASE_JWT_SECRET`: eski (legacy) HS256 JWT secret'ı. Legacy anahtar iptal edilmediği sürece geçerlidir.
 * Hiçbiri yoksa uç 503 döner. Mobil 503'te anon bağlantıyla devam eder, bu sayede env eklenmeden de yayın güvenli olur.
 */

/**
 * 10 dk. Banlanan kullanıcı yeni token alamaz (ban önbelleği ≤60 sn), elindeki token da en geç bu sürede biter.
 * Ban ayrıca tüm eşleşmelerini `is_active=false` yapar ve 082/083 policy'si teslimatı anında keser.
 * Silinen hesabın refresh token'ları silinir: erişim ≤15 dk + bu süre, yalnız kendi sohbetleri.
 * Maliyet: aktif kullanıcı başına 10 dk'da 1 istek, Supabase'e en çok 1 ban okuması (supabase-cost-guard).
 */
export const REALTIME_TOKEN_TTL_SEC = 600;

export type RealtimeSignerKind = "es256" | "hs256" | "disabled";

export interface RealtimeTokenConfig {
  privateJwk?: string;
  legacySecret?: string;
  /** Supabase Auth'un `iss` değeri: `<SUPABASE_URL>/auth/v1`. */
  issuer: string;
  /**
   * Sunucunun kendi API token sırları. Legacy secret bunlardan biriyle aynıysa imzalayıcı kapanır.
   * Aksi halde Realtime token'ı API'de de geçerli bir erişim token'ı olurdu (ve tersi).
   */
  forbiddenSecrets?: string[];
  ttlSec?: number;
  now?: () => number;
}

export interface RealtimeToken {
  token: string;
  expiresAt: string;
}

type Signer =
  | { kind: "es256"; key: KeyObject; kid: string }
  | { kind: "hs256"; secret: string }
  | { kind: "disabled"; reason: string };

export interface RealtimeTokenService {
  readonly kind: RealtimeSignerKind;
  /** Kapalıysa sebep (sır içermez; açılış logunda basılır). */
  readonly disabledReason: string | null;
  issue(userId: string): RealtimeToken;
}

function parseEs256Jwk(raw: string): { key: KeyObject; kid: string } {
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("SUPABASE_JWT_PRIVATE_JWK is not valid JSON");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Error("SUPABASE_JWT_PRIVATE_JWK must be an EC P-256 key");
  if (typeof jwk.d !== "string" || jwk.d.length === 0) throw new Error("SUPABASE_JWT_PRIVATE_JWK has no private part (d)");
  if (typeof jwk.kid !== "string" || jwk.kid.length === 0) throw new Error("SUPABASE_JWT_PRIVATE_JWK has no kid");
  const key = createPrivateKey({ key: jwk as JsonWebKey, format: "jwk" });
  return { key, kid: jwk.kid };
}

function buildSigner(cfg: RealtimeTokenConfig): Signer {
  const jwkRaw = cfg.privateJwk?.trim();
  if (jwkRaw) {
    try {
      return { kind: "es256", ...parseEs256Jwk(jwkRaw) };
    } catch (e) {
      // Bozuk anahtar sessizce HS256'ya düşmesin: yanlış yapılandırma görünür kalsın (fail-closed).
      return { kind: "disabled", reason: e instanceof Error ? e.message : "invalid JWK" };
    }
  }
  const secret = cfg.legacySecret?.trim();
  if (secret) {
    if (cfg.forbiddenSecrets?.includes(secret)) {
      return { kind: "disabled", reason: "SUPABASE_JWT_SECRET must differ from the API JWT secrets" };
    }
    return { kind: "hs256", secret };
  }
  return { kind: "disabled", reason: "no signing key configured" };
}

export function createRealtimeTokenService(cfg: RealtimeTokenConfig): RealtimeTokenService {
  const signer = buildSigner(cfg);
  const ttlSec = cfg.ttlSec ?? REALTIME_TOKEN_TTL_SEC;
  const now = cfg.now ?? Date.now;

  return {
    kind: signer.kind,
    disabledReason: signer.kind === "disabled" ? signer.reason : null,

    issue(userId: string): RealtimeToken {
      if (signer.kind === "disabled") throw Errors.REALTIME_TOKEN_UNAVAILABLE();
      const iat = Math.floor(now() / 1000);
      const exp = iat + ttlSec;
      const payload = {
        sub: userId,
        role: "authenticated",
        aud: "authenticated",
        iss: cfg.issuer,
        iat,
        exp,
        is_anonymous: false,
      };
      const token =
        signer.kind === "es256"
          ? jwt.sign(payload, signer.key, { algorithm: "ES256", keyid: signer.kid })
          : jwt.sign(payload, signer.secret, { algorithm: "HS256" });
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    },
  };
}

export const realtimeTokenService: RealtimeTokenService = createRealtimeTokenService({
  privateJwk: env.SUPABASE_JWT_PRIVATE_JWK,
  legacySecret: env.SUPABASE_JWT_SECRET,
  issuer: `${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`,
  forbiddenSecrets: [env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET],
});
