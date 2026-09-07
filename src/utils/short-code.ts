import { randomInt } from "node:crypto";

/**
 * Elle okunup yazılabilen kısa kodlar (davet kodu, web testi slug'ı).
 * I/O/0/1 yok: destek taleplerinin klasik sebebi. CSPRNG: `Math.random` (xorshift128+)
 * birkaç çıktıdan tahmin edilebilir; herkese açık bir link için bu yetmez.
 */
export const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SHORT_CODE_LENGTH = 8;
export const SHORT_CODE_PATTERN = new RegExp(`^[${SHORT_CODE_ALPHABET}]{${SHORT_CODE_LENGTH}}$`, "i");

export function generateShortCode(length = SHORT_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return code;
}
