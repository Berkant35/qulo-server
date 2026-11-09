/**
 * Sesli/gorselli soru (2.0.19) sinirlari — tek kaynak: bucket tanimi (config/supabase),
 * multer sinirlari (routes/question.routes), validator ve servis buradan okur.
 */
export const QUESTION_MEDIA_BUCKET = "question-media";

/** Bucket private; istemci dosyaya yalniz bu omurlu imzali URL ile ulasir. */
export const QUESTION_MEDIA_SIGNED_URL_TTL_SEC = 600;

export const VOICE_MAX_DURATION_MS = 15_000;
export const VOICE_MAX_BYTES = 1 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const VOICE_MIME_TYPES: readonly string[] = ["audio/m4a", "audio/mp4", "audio/aac"];
export const IMAGE_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

export const QUESTION_MEDIA_KINDS = ["voice", "image"] as const;
export type QuestionMediaKind = (typeof QUESTION_MEDIA_KINDS)[number];

/**
 * Cozucuye ek sure (quiz son ani): ses varsa `ceil(sure) + VOICE_EXTRA_BUFFER_SECONDS`, onayli
 * gorsel varsa `+ IMAGE_EXTRA_SECONDS`. Yalniz medya kapisi acikken (bkz. `mediaExtraSeconds`).
 */
export const VOICE_EXTRA_BUFFER_SECONDS = 3;
export const IMAGE_EXTRA_SECONDS = 3;
