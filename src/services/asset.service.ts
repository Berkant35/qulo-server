import { supabase } from "../config/supabase.js";

const BUCKET = "assets";

export interface AssetItem {
  name: string;
  url: string;
  size: number | null;
  createdAt: string | null;
  mimeType: string | null;
}

// SVG kasıtlı olarak yok: public bucket'tan inline servis edilen SVG, gömülü
// script/event handler ile stored XSS taşıyabilir. Sadece raster formatlar.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Yüklenebilir dosya adı: slugify çıktısı + zaman damgası + bilinen uzantı. */
const NAME_PATTERN = /^[a-z0-9-]+\.(jpg|png|webp|gif)$/;

function slugifyBase(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "asset";
}

class AssetService {
  /** Bucket kökündeki tüm varlıkları public URL'leriyle birlikte döndürür (yeniden eskiye). */
  async list(): Promise<AssetItem[]> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw new Error(error.message);

    return (data ?? [])
      .filter((f) => f.name && f.name !== ".emptyFolderPlaceholder")
      .map((f) => {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(f.name);
        return {
          name: f.name,
          url: urlData.publicUrl,
          size: (f.metadata?.size as number) ?? null,
          createdAt: f.created_at ?? null,
          mimeType: (f.metadata?.mimetype as string) ?? null,
        };
      });
  }

  /** Tampondaki dosyayı yükler, çakışmayı önlemek için zaman damgalı isim verir, public URL döndürür. */
  async upload(buffer: Buffer, originalName: string, mimeType: string): Promise<AssetItem> {
    const ext = EXT_BY_MIME[mimeType];
    if (!ext) {
      throw new Error("Desteklenmeyen dosya türü. Yalnızca PNG, JPG, WEBP, GIF yüklenebilir.");
    }
    const fileName = `${slugifyBase(originalName)}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });
    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return {
      name: fileName,
      url: urlData.publicUrl,
      size: buffer.length,
      createdAt: new Date().toISOString(),
      mimeType,
    };
  }

  async remove(name: string): Promise<void> {
    // Yalnızca bu sistemin ürettiği isim biçimi silinebilir — keyfi path / traversal engellenir.
    if (!NAME_PATTERN.test(name)) {
      throw new Error("Geçersiz dosya adı.");
    }
    const { error } = await supabase.storage.from(BUCKET).remove([name]);
    if (error) throw new Error(error.message);
  }
}

export const assetService = new AssetService();
