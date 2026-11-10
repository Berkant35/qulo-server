import type { Request } from "express";
import { mediaQuestionsActive } from "../services/media-questions-gate.js";

/**
 * Sesli/gorselli soru kapisi (>= 2.0.18+101 VE `media_questions_enabled`), istek yolunu bozmayan surum:
 * kapi hatasi medya kapali sayilir (fail-closed) — eski istemci zaten surum kontrolunde elenir.
 * Servisler baslik okumaz, `{ active }` alir (test edilebilir).
 */
export async function mediaActiveFailClosed(req: Request, scope: string): Promise<boolean> {
  try {
    return await mediaQuestionsActive(req.headers);
  } catch (err) {
    console.error(`[${scope}] media gate failed:`, err);
    return false;
  }
}
