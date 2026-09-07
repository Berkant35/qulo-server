import { z } from "zod";
import { SUPPORTED_LOCALES } from "../constants/locales.js";
import { WEB_QUIZ_QUESTION_COUNT } from "../constants/web-quiz.js";
import { SHORT_CODE_PATTERN } from "../utils/short-code.js";

const localeSchema = z.enum(SUPPORTED_LOCALES);

/** Slug alfabesi referral koduyla aynı (I/O/0/1 yok); büyük/küçük harf kabul, servis büyütür. */
export const slugParamSchema = z.object({
  slug: z.string().regex(SHORT_CODE_PATTERN, "invalid slug"),
});

export const bankQuerySchema = z.object({
  locale: localeSchema,
});

// Herkese açık başlıkta gösterilen tek serbest metin — kimlik taklidi için basit liste.
const RESERVED_NICKNAMES = /^(qulo|qulo\s*app|admin|moderator|support|destek)$/i;

// Takma ad: kontrol karakteri yok (RTL override/ZWSP dahil), 24 karakter.
const nicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[^\p{C}]+$/u, "nickname contains control characters")
  .refine((v) => !RESERVED_NICKNAMES.test(v), { message: "reserved nickname" });

export const createWebQuizSchema = z
  .object({
    locale: localeSchema,
    nickname: nicknameSchema,
    // 18+ onayı istemci kutusu değil, sunucu şartı — NGL'nin reşit olmayan cezası dersi.
    age_confirmed: z.literal(true),
    items: z
      .array(
        z.object({
          bank_id: z.string().uuid(),
          correct: z.number().int().min(0).max(3),
        }),
      )
      .length(WEB_QUIZ_QUESTION_COUNT),
  })
  .refine((d) => new Set(d.items.map((i) => i.bank_id)).size === d.items.length, {
    message: "duplicate questions",
    path: ["items"],
  });

export const attemptSchema = z.object({
  answers: z.array(z.number().int().min(0).max(3)).length(WEB_QUIZ_QUESTION_COUNT),
});

export type CreateWebQuizInput = z.infer<typeof createWebQuizSchema>;
export type AttemptInput = z.infer<typeof attemptSchema>;
export type BankQueryInput = z.infer<typeof bankQuerySchema>;
