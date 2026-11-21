import { createHmac, createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import { supabase } from "../config/supabase.js";
import { diamondService } from "./diamond.service.js";
import { economyConfigService } from "./economy-config.service.js";
import { googleKeyProvider, type VerifierKeyProvider } from "./admob-ssv-keys.js";
import { Errors } from "../utils/errors.js";

/**
 * Günlük ödüllü reklam (2.2.0, B3) — AdMob sunucu taraflı doğrulama (SSV).
 * Kaynak: https://developers.google.com/admob/android/rewarded-video-ssv (2026-11-18).
 * Para yolu: çift ödül kritik hata. Katmanlar: Google imzası -> ad_unit izin listesi -> kullanıcıya
 * bağlı günlük HMAC jetonu -> config -> `rewarded_ad_claims` (transaction_id PK + user/gün/slot UNIQUE)
 * -> addPurple (reference_id ile ikinci kez tekilleştirme).
 */

export const REWARDED_AD_REASON = "REWARDED_AD";
const TOKEN_VERSION = "v1";
/** Callback `timestamp`'ı (Google, imzalı) ile şimdi arasındaki en çok fark; eski callback tekrarını keser. */
const MAX_CALLBACK_AGE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Ortam ──
function tokenSecret(): string | null {
  const s = process.env.REWARDED_AD_TOKEN_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** Google `ad_unit` yalnız sayısal birim kimliğidir; "ca-app-pub-x/123" yazılmışsa son parça alınır. */
function normalizeUnit(raw: string): string {
  const t = raw.trim();
  return t.slice(t.lastIndexOf("/") + 1);
}

function allowedAdUnits(): Set<string> {
  return new Set(
    (process.env.REWARDED_AD_UNIT_IDS ?? "").split(",").map(normalizeUnit).filter((u) => u.length > 0),
  );
}

// ── Gün / jeton ──
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function nextUtcMidnightIso(ms: number): string {
  return new Date((Math.floor(ms / DAY_MS) + 1) * DAY_MS).toISOString();
}

function mac(secret: string, userId: string, day: string, nonce: string): string {
  return createHmac("sha256", secret).update(`${TOKEN_VERSION}|${userId}|${day}|${nonce}`).digest("base64url");
}

/** Kullanıcıya + o güne (UTC) bağlı imzalı jeton: `v1.<yyyy-mm-dd>.<nonce>.<mac>`. */
export function mintCustomData(userId: string, nowMs: number, secret: string): string {
  const day = utcDay(nowMs);
  const nonce = randomBytes(9).toString("base64url");
  return `${TOKEN_VERSION}.${day}.${nonce}.${mac(secret, userId, day, nonce)}`;
}

/** Geçerliyse jetonun günü; değilse null. Kullanıcı ve gün jetona bağlı — başkasının/dünün jetonu geçmez. */
export function verifyCustomData(token: string, userId: string, secret: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const [, day, nonce, given] = parts as [string, string, string, string];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[A-Za-z0-9_-]{1,32}$/.test(nonce)) return null;
  const expected = Buffer.from(mac(secret, userId, day, nonce));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return day;
}

// ── SSV sorgusu ──
export interface ParsedSsv {
  /** İmzalanan ham içerik: `signature` öncesi sorgu dizesi, sırası bozulmadan. */
  signedContent: string;
  signature: string;
  keyId: string;
  params: Map<string, string>;
}

/**
 * Ham sorgudan (decode edilmemiş) ayrıştırır. Sıkı: kuyruk TAM `&signature=…&key_id=…` olmalı
 * (imzasız parametre eklenip okunmasın), imzalı kısımda yinelenen anahtar olamaz.
 */
export function parseSsvQuery(rawQuery: string): ParsedSsv | null {
  const m = /^(.+)&signature=([^&]+)&key_id=([^&]+)$/.exec(rawQuery);
  if (!m) return null;
  const [, signedContent, signature, keyId] = m as unknown as [string, string, string, string];
  const params = new Map<string, string>();
  for (const pair of signedContent.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(pair.slice(0, eq));
      value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (params.has(key)) return null;
    params.set(key, value);
  }
  return { signedContent, signature, keyId, params };
}

/** ECDSA SHA-256, DER imza, web-safe base64. Anahtar yoksa/bozuksa false. */
export async function verifySsvSignature(parsed: ParsedSsv, keys: VerifierKeyProvider): Promise<boolean> {
  const pem = await keys(parsed.keyId);
  if (!pem) return false;
  try {
    const verifier = createVerify("SHA256");
    verifier.update(Buffer.from(parsed.signedContent, "utf8"));
    return verifier.verify(pem, Buffer.from(parsed.signature, "base64url"));
  } catch {
    return false;
  }
}

// ── Durum ──
export interface RewardedAdStatus {
  available: boolean;
  purple: number;
  resetsAt: string;
  customData: string | null;
}

export type SsvOutcome =
  | "invalid_signature"
  | "rewarded"
  | "ignored_unit"
  | "ignored_token"
  | "ignored_stale"
  | "ignored_disabled"
  | "user_ineligible"
  | "ignored_limit"
  | "ignored_duplicate"
  | "ignored_conflict";

export interface SsvDeps {
  keys?: VerifierKeyProvider;
  now?: () => number;
}

class RewardedAdService {
  /** Ödül yalnız var olan, silinmemiş ve banlı olmayan kullanıcıya. Okuma hatası fırlatır (SSV 500 -> Google yeniden dener). */
  private async isEligibleUser(userId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("users")
      .select("is_banned, is_deleted")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return !!data && data.is_banned !== true && data.is_deleted !== true;
  }

  /** Mobilin reklam öncesi çağırdığı uç. Kapalı/sır yok/birim yok/limit dolu -> available=false. */
  async getStatus(userId: string, nowMs = Date.now()): Promise<RewardedAdStatus> {
    const resetsAt = nextUtcMidnightIso(nowMs);
    const { config } = await economyConfigService.getActiveConfig();
    const cfg = config.rewards.rewardedAd;
    const secret = tokenSecret();
    const closed: RewardedAdStatus = { available: false, purple: cfg.purple, resetsAt, customData: null };
    if (!cfg.enabled || cfg.purple <= 0 || cfg.dailyLimit <= 0 || !secret || allowedAdUnits().size === 0) return closed;

    try {
      if (!(await this.isEligibleUser(userId))) return closed;
    } catch {
      return closed; // okunamadı: ödül vermeyen güvenli taraf
    }

    const { count, error } = await supabase
      .from("rewarded_ad_claims")
      .select("transaction_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("day", utcDay(nowMs));
    if (error) {
      // Tablo yok / okuma hatası: ödül vermeyen güvenli taraf; uç çökmez.
      console.error("[RewardedAd] status claim count failed", { userId, code: error.code });
      return closed;
    }
    if ((count ?? 0) >= cfg.dailyLimit) return closed;
    return { available: true, purple: cfg.purple, resetsAt, customData: mintCustomData(userId, nowMs, secret) };
  }

  /**
   * Google'ın SSV callback'i. `httpStatus`: 400 yalnız imza/biçim geçersizse; imzası geçerli her
   * işlenmiş/yoksayılmış durum 200 (Google yeniden denemesin). Beklenmeyen DB hatası fırlatır (500 -> yeniden dener).
   */
  async handleCallback(rawQuery: string, deps: SsvDeps = {}): Promise<{ httpStatus: 200 | 400; outcome: SsvOutcome }> {
    const keys = deps.keys ?? googleKeyProvider;
    const nowMs = (deps.now ?? Date.now)();

    const parsed = parseSsvQuery(rawQuery);
    if (!parsed || !(await verifySsvSignature(parsed, keys))) {
      console.warn("[RewardedAd] SSV invalid signature or malformed query");
      return { httpStatus: 400, outcome: "invalid_signature" };
    }

    const { params } = parsed;
    const txId = params.get("transaction_id");
    const userId = params.get("user_id");
    const adUnit = params.get("ad_unit");
    const customData = params.get("custom_data");
    const tsMs = Number(params.get("timestamp"));
    const ignore = (outcome: SsvOutcome) => {
      console.warn("[RewardedAd] SSV ignored", { outcome, userId, txId });
      return { httpStatus: 200 as const, outcome };
    };

    if (!txId || !userId || !adUnit || !customData || !Number.isFinite(tsMs)) return ignore("ignored_token");
    if (!allowedAdUnits().has(normalizeUnit(adUnit))) return ignore("ignored_unit");

    const secret = tokenSecret();
    const tokenDay = secret ? verifyCustomData(customData, userId, secret) : null;
    // Gün = Google'ın (imzalı) olay zamanının UTC günü; jeton aynı güne ait olmalı.
    if (!tokenDay || tokenDay !== utcDay(tsMs)) return ignore("ignored_token");
    if (Math.abs(nowMs - tsMs) > MAX_CALLBACK_AGE_MS) return ignore("ignored_stale");

    const { config } = await economyConfigService.getActiveConfig();
    const cfg = config.rewards.rewardedAd;
    if (!cfg.enabled || cfg.purple <= 0 || cfg.dailyLimit <= 0) return ignore("ignored_disabled");

    if (!(await this.isEligibleUser(userId))) return ignore("user_ineligible");

    // 1) Bu işlem daha önce talep edildi mi? (Google yeniden denemesi / kısmi başarısızlık onarımı)
    const prior = await this.findClaim(txId);
    if (prior) return this.settleExisting(prior, userId);

    // 2) Günün ilk boş slotunu talep et (atomik: DB benzersiz kısıtı).
    for (let slot = 1; slot <= cfg.dailyLimit; slot++) {
      const referenceId = `${REWARDED_AD_REASON}:${userId}:${tokenDay}:${slot}`;
      const { error } = await supabase.from("rewarded_ad_claims").insert({
        transaction_id: txId,
        user_id: userId,
        day: tokenDay,
        slot,
        reference_id: referenceId,
        amount: cfg.purple,
      });
      if (!error) {
        const res = await diamondService.addPurple(userId, cfg.purple, REWARDED_AD_REASON, referenceId);
        console.log("[RewardedAd] SSV rewarded", { userId, txId, slot, credited: res.credited });
        return { httpStatus: 200, outcome: res.credited > 0 ? "rewarded" : "ignored_duplicate" };
      }
      if (error.code !== "23505") {
        console.error("[RewardedAd] claim insert failed", { userId, txId, code: error.code });
        throw Errors.SERVER_ERROR();
      }
      // 23505: ya aynı işlem yarışı kazanıldı ya da slot dolu.
      const raced = await this.findClaim(txId);
      if (raced) return this.settleExisting(raced, userId);
    }
    return ignore("ignored_limit");
  }

  private async findClaim(txId: string): Promise<{ user_id: string; reference_id: string; amount: number } | null> {
    const { data, error } = await supabase
      .from("rewarded_ad_claims")
      .select("user_id, reference_id, amount")
      .eq("transaction_id", txId)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[RewardedAd] claim lookup failed", { txId, code: error.code });
      throw Errors.SERVER_ERROR();
    }
    return data as { user_id: string; reference_id: string; amount: number } | null;
  }

  /** Talep zaten var: addPurple aynı reference_id ile idempotent — yatmamışsa tamamlar, yatmışsa 0. */
  private async settleExisting(
    claim: { user_id: string; reference_id: string; amount: number },
    userId: string,
  ): Promise<{ httpStatus: 200; outcome: SsvOutcome }> {
    if (claim.user_id !== userId) {
      console.warn("[RewardedAd] SSV transaction owned by another user", { userId });
      return { httpStatus: 200, outcome: "ignored_conflict" };
    }
    const res = await diamondService.addPurple(userId, claim.amount, REWARDED_AD_REASON, claim.reference_id);
    return { httpStatus: 200, outcome: res.credited > 0 ? "rewarded" : "ignored_duplicate" };
  }
}

export const rewardedAdService = new RewardedAdService();
