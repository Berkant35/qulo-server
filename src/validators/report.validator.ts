import { z } from "zod";

export const createReportSchema = z.object({
  reported_id: z.string().uuid(),
  // OPSIYONEL (2026-09-09): zorunluydu ve istemci bunu bilmiyordu. Her iki
  // sikayet ekrani da `reason.isNotEmpty ? reason : null` gonderiyor
  // (chat_moderation_mixin.dart:130, profile_detail_screen_mixin.dart:200),
  // yani sebep yazmayan kullanicinin sikayeti 400 aliyordu — ustelik cagri
  // yerleri sonucu kontrol etmedigi icin kullanici hata bile gormuyordu.
  // Sikayetin ozunu `category` tasiyor; serbest metin ek bilgi.
  // `min(5)` de kaldirildi (review bulgusu): ayni bug'in daralmis hali.
  // Chat sikayet dialog'unda ne minimum ne maxLength var
  // (chat_moderation_mixin.dart:110-114), yani "spam" (4 harf) yazan kullanici
  // ya da 1000 karakteri asan yapistirma yine 400 alir ve YINE sessizce
  // kaybolurdu. Serbest metin gercekten "ek bilgi": kapi yalnizca enum.
  // `trim` + bos-ise-undefined, sadece bosluktan ibaret metni de kapatiyor.
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  category: z.enum([
    "INAPPROPRIATE_CONTENT",
    "FAKE_PROFILE",
    "SPAM",
    "HARASSMENT",
    "UNDERAGE",
    "SCAM",
    "OFFENSIVE_PHOTOS",
    "THREATENING",
    "IMPERSONATION",
    "OTHER",
  ]),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
