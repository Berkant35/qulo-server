import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { normalizeUploadedImage, NORMAL_GORSEL_MIME } from "../utils/image-normalize.js";
import { DEGISMEZ_DOSYA_CACHE_CONTROL } from "../constants/storage.js";
import { moderateQuestionImage, type QuestionImageModerationStatus } from "./question-image-moderation.service.js";
import {
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  QUESTION_MEDIA_BUCKET,
  QUESTION_MEDIA_SIGNED_URL_TTL_SEC,
  VOICE_MAX_BYTES,
  VOICE_MAX_DURATION_MS,
  VOICE_MIME_TYPES,
  type QuestionMediaKind,
} from "../constants/question-media.js";

export type QuestionImageStatus = QuestionImageModerationStatus;

/** Sahibe (GET /questions/me, yukleme yaniti) donen medya alanlari; URL'ler imzali, ham yol donmez. */
export type OwnerQuestionMedia = {
  voice_url: string | null;
  voice_duration_ms: number | null;
  image_url: string | null;
  image_status: QuestionImageStatus | null;
};

/** `questions` medya kolonlari (084). Migration oncesi satirda yoklar → `undefined`, bos sayilir. */
export interface QuestionMediaColumns {
  voice_path?: string | null;
  voice_duration_ms?: number | null;
  image_path?: string | null;
  image_status?: QuestionImageStatus | null;
}

type OwnedQuestion = QuestionMediaColumns & { id: string };
/** `select("*")` tipsiz (`any`) satir doner: `any` korunur (Omit onu index imzasina cevirirdi). */
type WithOwnerMedia<T> = 0 extends 1 & T ? any : Omit<T, "voice_path" | "image_path"> & OwnerQuestionMedia;

const MEDIA_COLUMNS = "id, voice_path, voice_duration_ms, image_path, image_status";

/**
 * Hesap silmede klasor basina tek liste sayfasi: kullanicinin soru klasoru sayisi plan `maxQuestions`
 * (<= 20) ile, klasordeki dosya sayisi da (her tur icin tek gecerli dosya) ile sinirli.
 */
const PURGE_LIST_LIMIT = 1000;

const SLOT = {
  voice: { pathColumn: "voice_path", extension: "m4a", cleared: { voice_path: null, voice_duration_ms: null } },
  image: { pathColumn: "image_path", extension: "jpg", cleared: { image_path: null, image_status: null } },
} as const;

/**
 * Beyan edilen ses turune guvenilmez: icerik bir ses kabi mi? MP4/M4A (`ftyp` kutusu, 4. bayt)
 * ya da ADTS AAC (12 bitlik 0xFFF senkron, katman 00). Mobil kayit `AudioEncoder.aacLc` → M4A.
 */
function isAudioContainer(buf: Buffer): boolean {
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return true;
  return buf.length >= 7 && buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0;
}

/**
 * Moderasyon sonucunu yazilmis satira uygular (yeniden okuma yok): ret yolu bosaltir, onay durumu yazar.
 * `pending` (zaman asimi ya da araya giren yeni yukleme) satiri oldugu gibi birakir.
 */
function withModeration(row: OwnedQuestion, status: QuestionImageStatus): OwnedQuestion {
  if (status === "rejected") return { ...row, image_path: null, image_status: "rejected" };
  if (status === "approved") return { ...row, image_status: "approved" };
  return row;
}

/**
 * Soru medyasi (sesli/gorselli soru, 2.0.19) — PRIVATE `question-media` bucket'i.
 *
 * - Yol yalniz sunucu kimliklerinden kurulur: `${userId}/${questionId}/${kind}-${ts}.(m4a|jpg)`;
 *   soru `user_id + order_num` ile bulunur — baskasinin sorusuna yazilamaz/silinemez.
 * - Dosya once yazilir, sonra satir (karsilastir-ve-degistir: okunan eski yol hala yerindeyse).
 *   Satir yazilamazsa yeni dosya geri silinir; eski dosya ancak satir yeni yolu gosterince silinir.
 * - Silmede once satir bosaltilir, sonra dosya: satir hicbir zaman olmayan dosyayi gostermez.
 */
class QuestionMediaService {
  async uploadVoice(
    userId: string,
    orderNum: number,
    buf: Buffer,
    mime: string,
    durationMs: number,
  ): Promise<OwnerQuestionMedia> {
    if (!VOICE_MIME_TYPES.includes(mime)) throw Errors.INVALID_FILE_TYPE();
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > VOICE_MAX_DURATION_MS) {
      throw Errors.VALIDATION_ERROR({ duration_ms: `Must be an integer between 1 and ${VOICE_MAX_DURATION_MS}` });
    }
    if (buf.length > VOICE_MAX_BYTES) throw Errors.PAYLOAD_TOO_LARGE();
    if (!isAudioContainer(buf)) throw Errors.INVALID_FILE_TYPE();

    const question = await this.findOwned(userId, orderNum);
    const row = await this.writeSlot(userId, question, "voice", buf, mime, { voice_duration_ms: durationMs });
    return this.ownerMedia(row);
  }

  async uploadImage(userId: string, orderNum: number, buf: Buffer, mime: string): Promise<OwnerQuestionMedia> {
    if (!IMAGE_MIME_TYPES.includes(mime)) throw Errors.INVALID_FILE_TYPE();
    if (buf.length > IMAGE_MAX_BYTES) throw Errors.PAYLOAD_TOO_LARGE();

    // Soru once bulunur: olmayan soru icin gorsel cozme (CPU) yapilmaz.
    const question = await this.findOwned(userId, orderNum);
    const jpeg = await normalizeUploadedImage(buf, "question-media");
    const row = await this.writeSlot(userId, question, "image", jpeg, NORMAL_GORSEL_MIME, { image_status: "pending" });
    // Satir 'pending' yazildi; senkron moderasyon (<= 8 sn). Hata/zaman asimi 'pending' doner, cron yeniden dener.
    const status = await moderateQuestionImage(row.id, { image: { path: row.image_path!, bytes: jpeg } });
    return this.ownerMedia(withModeration(row, status));
  }

  async removeMedia(userId: string, orderNum: number, kind: QuestionMediaKind): Promise<void> {
    const { pathColumn, cleared } = SLOT[kind];
    const question = await this.findOwned(userId, orderNum);
    const oldPath = question[pathColumn] ?? null;
    if (!oldPath) return;

    const { data, error } = await supabase
      .from("questions")
      .update(cleared)
      .eq("id", question.id)
      .eq("user_id", userId)
      .eq(pathColumn, oldPath)
      .select("id");
    if (error) {
      console.error("[question-media] remove: satir guncellenemedi:", error.message);
      throw Errors.SERVER_ERROR();
    }
    if (!data || data.length === 0) throw Errors.QUESTION_MEDIA_CONFLICT();

    await this.removePaths([oldPath]);
  }

  /** Private bucket icin 600 sn imzali URL; yol yoksa ya da imzalanamazsa `null` (yanit patlamaz). */
  async signedUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await supabase.storage
      .from(QUESTION_MEDIA_BUCKET)
      .createSignedUrl(path, QUESTION_MEDIA_SIGNED_URL_TTL_SEC);
    if (error || !data) {
      console.warn("[question-media] imzalanamadi:", path, error?.message);
      return null;
    }
    return data.signedUrl;
  }

  /**
   * Satirlara sahip medya alanlarini ekler, ham yollari cikarir. Tum yollar TEK istekle imzalanir
   * (`createSignedUrls`); medyasiz listede hic istek yok. Sahip kendi `pending` gorselini de gorur.
   */
  async withOwnerMedia<T extends QuestionMediaColumns>(rows: T[]): Promise<Array<WithOwnerMedia<T>>> {
    const urls = await this.signMany(rows.flatMap((row) => [row.voice_path, row.image_path]));
    return rows.map((row) => {
      const { voice_path: _voice, image_path: _image, ...rest } = row;
      return { ...rest, ...this.mediaFields(row, urls) };
    });
  }

  /** Soru satiri silindikten sonra dosyalari. Hata loglanir, firlatilmaz: satir zaten gitti. */
  async removeAllForQuestion(row: { voice_path?: string | null; image_path?: string | null }): Promise<void> {
    const paths = [row.voice_path, row.image_path].filter((p): p is string => !!p);
    if (paths.length > 0) await this.removePaths(paths);
  }

  /**
   * Kalici hesap silme: `${userId}/` altindaki her soru klasoru (iki seviye — ust liste klasorleri
   * `id: null` doner). Bir klasordeki hata digerlerini durdurmaz.
   */
  async removeAllForUser(userId: string): Promise<void> {
    const bucket = supabase.storage.from(QUESTION_MEDIA_BUCKET);
    const { data: entries, error } = await bucket.list(userId, { limit: PURGE_LIST_LIMIT });
    if (error) {
      console.warn(`[question-media] ${userId}/ listelenemedi:`, error.message);
      return;
    }

    const loose: string[] = [];
    for (const entry of entries ?? []) {
      if (entry.id !== null) {
        loose.push(`${userId}/${entry.name}`);
        continue;
      }
      const folder = `${userId}/${entry.name}`;
      const { data: files, error: listError } = await bucket.list(folder, { limit: PURGE_LIST_LIMIT });
      if (listError) {
        console.warn(`[question-media] ${folder}/ listelenemedi:`, listError.message);
        continue;
      }
      const paths = (files ?? []).filter((f) => f.id !== null).map((f) => `${folder}/${f.name}`);
      if (paths.length > 0) await this.removePaths(paths);
    }
    if (loose.length > 0) await this.removePaths(loose);
  }

  private async findOwned(userId: string, orderNum: number): Promise<OwnedQuestion> {
    const { data, error } = await supabase
      .from("questions")
      .select(MEDIA_COLUMNS)
      .eq("user_id", userId)
      .eq("order_num", orderNum)
      .maybeSingle();
    if (error) {
      console.error("[question-media] soru okunamadi:", error.message);
      throw Errors.SERVER_ERROR();
    }
    if (!data) throw Errors.QUESTION_NOT_FOUND();
    return data as OwnedQuestion;
  }

  private async writeSlot(
    userId: string,
    question: OwnedQuestion,
    kind: QuestionMediaKind,
    body: Buffer,
    contentType: string,
    extra: Record<string, unknown>,
  ): Promise<OwnedQuestion> {
    const { pathColumn, extension } = SLOT[kind];
    const path = `${userId}/${question.id}/${kind}-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(QUESTION_MEDIA_BUCKET)
      .upload(path, body, { contentType, cacheControl: DEGISMEZ_DOSYA_CACHE_CONTROL, upsert: false });
    if (uploadError) {
      console.error("[question-media] yukleme basarisiz:", uploadError.message);
      throw Errors.SERVER_ERROR();
    }

    const oldPath = question[pathColumn] ?? null;
    const base = supabase
      .from("questions")
      .update({ [pathColumn]: path, ...extra })
      .eq("id", question.id)
      .eq("user_id", userId);
    const guarded = oldPath === null ? base.is(pathColumn, null) : base.eq(pathColumn, oldPath);
    const { data, error } = await guarded.select(MEDIA_COLUMNS);

    if (error) {
      console.error("[question-media] satir guncellenemedi:", error.message);
      await this.removePaths([path]);
      throw Errors.SERVER_ERROR();
    }
    if (!data || data.length === 0) {
      // Okumadan sonra baska bir istek yolu degistirdi ya da soru silindi: yeni dosya sahipsiz kalmasin.
      await this.removePaths([path]);
      throw Errors.QUESTION_MEDIA_CONFLICT();
    }

    if (oldPath) await this.removePaths([oldPath]);
    return data[0] as OwnedQuestion;
  }

  private async ownerMedia(row: QuestionMediaColumns): Promise<OwnerQuestionMedia> {
    const urls = await this.signMany([row.voice_path, row.image_path]);
    return this.mediaFields(row, urls);
  }

  private mediaFields(row: QuestionMediaColumns, urls: Map<string, string>): OwnerQuestionMedia {
    return {
      voice_url: row.voice_path ? urls.get(row.voice_path) ?? null : null,
      voice_duration_ms: row.voice_duration_ms ?? null,
      image_url: row.image_path ? urls.get(row.image_path) ?? null : null,
      image_status: row.image_status ?? null,
    };
  }

  /** Tek istekte toplu imza; hata → bos harita (URL'ler null doner, liste yine gelir). */
  private async signMany(candidates: Array<string | null | undefined>): Promise<Map<string, string>> {
    const paths = [...new Set(candidates.filter((p): p is string => !!p))];
    const urls = new Map<string, string>();
    if (paths.length === 0) return urls;

    const { data, error } = await supabase.storage
      .from(QUESTION_MEDIA_BUCKET)
      .createSignedUrls(paths, QUESTION_MEDIA_SIGNED_URL_TTL_SEC);
    if (error || !data) {
      console.warn("[question-media] toplu imza basarisiz:", error?.message);
      return urls;
    }
    for (const item of data) {
      if (!item.error && item.path) urls.set(item.path, item.signedUrl);
    }
    return urls;
  }

  private async removePaths(paths: string[]): Promise<void> {
    const { error } = await supabase.storage.from(QUESTION_MEDIA_BUCKET).remove(paths);
    if (error) console.warn("[question-media] dosya silinemedi:", paths.join(", "), error.message);
  }
}

export const questionMediaService = new QuestionMediaService();
