import { z } from "zod";
import { QUESTION_MEDIA_KINDS, VOICE_MAX_DURATION_MS } from "../constants/question-media.js";

/** Sira tavani 20: `createQuestionSchema.order_num` ile ayni (asil kapi plan `maxQuestions`). */
export const questionOrderParamsSchema = z.object({
  order: z.coerce.number().int().min(1).max(20),
});

export const questionMediaParamsSchema = questionOrderParamsSchema.extend({
  kind: z.enum(QUESTION_MEDIA_KINDS),
});

/** Multipart alanlari metin gelir; `duration_ms` istemcinin olctugu kayit suresi. */
export const uploadVoiceBodySchema = z.object({
  duration_ms: z.coerce.number().int().min(1).max(VOICE_MAX_DURATION_MS),
});

export type QuestionMediaParams = z.infer<typeof questionMediaParamsSchema>;
export type UploadVoiceBody = z.infer<typeof uploadVoiceBodySchema>;
