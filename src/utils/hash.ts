import bcrypt from "bcryptjs";
import crypto from "crypto";
import { env } from "../config/env.js";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getRefreshTokenExpiry(): string {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
}

/**
 * Kötüye kullanım incelemesi için IP takma-adı. Sabit salt ile SHA-256 IPv4 uzayında
 * (2^32) dakikalar içinde geri çevrilir; HMAC gizli anahtarla korelasyon korunur,
 * geri çevirme kapanır. Anahtar env'den; ayrı değişken yoksa refresh secret'ı kullanır.
 */
export function hashIp(ip: string): string {
  const key = env.IP_HASH_SECRET || env.JWT_REFRESH_SECRET;
  return crypto.createHmac("sha256", key).update(ip).digest("hex").slice(0, 32);
}

/**
 * FNV-1a 32-bit — bagimliliksiz, deterministik (kriptografik DEGIL; sifre/token icin yukaridakiler).
 * Kullanim: holdout kovasi (ayni kullanici her turda ayni grupta) ve tekrarlayan kampanyanin
 * gunluk gonderim dakikasi (iki instance ayni sonucu bulur, ikinci gonderim olmaz).
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
