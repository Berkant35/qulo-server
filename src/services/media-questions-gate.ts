import type { IncomingHttpHeaders } from "http";
import { appConfigService } from "./app-config.service.js";
import { clientMetaFromHeaders, isClientAtLeast, MEDIA_QUESTIONS_MIN_CLIENT } from "../utils/client-meta.js";

/** Sesli/gorselli soru: surum kapisi (>= 2.0.18+101) VE `media_questions_enabled` ikisi de gecerliyse true. */
export async function mediaQuestionsActive(headers: IncomingHttpHeaders): Promise<boolean> {
  if (!isClientAtLeast(clientMetaFromHeaders(headers), MEDIA_QUESTIONS_MIN_CLIENT)) return false;
  return appConfigService.getMediaQuestionsEnabled();
}
