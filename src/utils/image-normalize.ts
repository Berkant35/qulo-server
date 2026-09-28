import sharp from "sharp";
import { Errors } from "./errors.js";
import { Semafor } from "./semaphore.js";

/**
 * Yüklenen görseli tek biçime indirir (2026-09-28 maliyet incelemesi).
 *
 * Neden: mobil kırpma paketi (crop_your_image) çıktıyı PNG üretiyor ve uygulama onu `image/jpeg`
 * beyanıyla yüklüyordu; 207 kullanıcı fotoğrafının örneklenen hepsi PNG'ydi (ort. 823 KB). Aynı
 * görüntünün JPEG q80'i %10-12 boyutunda. Egress kullanıcı sayısıyla büyüyen tek kalem ve çoğu
 * fotoğraf; düzeltme sunucuda olunca mağazadaki eski sürümler de kapsanır.
 *
 * - EXIF yönüne göre döndürür; metadata (EXIF/GPS) çıktıya YAZILMAZ (sharp varsayılanı).
 * - Uzun kenar en fazla `GORSEL_UZUN_KENAR` (3:4 dikey 1080×1440 aynen kalır); büyütmez.
 * - Şeffaf alan beyaza düşer; çıktı JPEG (mozjpeg).
 *
 * Güvenlik (review 2026-09-28, ölçüldü): çözme artık her kimlikli kullanıcının tetikleyebildiği
 * CPU/bellek işi. Beyan edilen mime'a güvenilmez; yalnız başlıktan okunan biçim sayılır.
 * - Yalnız JPEG/PNG/WebP: 294 baytlık filtreli bir SVG `image/png` diye gelince 20 sn CPU yakıyordu.
 * - Piksel sınırı 25 MP (sharp varsayılanı 268 MP; 784 KB'lık PNG bombası +263 MB bellek).
 * - İşlem başına zaman aşımı; aynı anda en fazla `ESZAMANLI_ISLEM` çözme (libuv'nin 4 iş
 *   parçacığı fs/crypto'ya kalsın) ve görsel başına tek libvips iş parçacığı.
 */
export const GORSEL_UZUN_KENAR = 1440;
export const JPEG_KALITESI = 80;
export const NORMAL_GORSEL_MIME = "image/jpeg";
export const PIKSEL_SINIRI = 25_000_000;
const KABUL_EDILEN_BICIMLER = new Set(["jpeg", "png", "webp"]);
const ISLEM_ZAMAN_ASIMI_SN = 5;
const ESZAMANLI_ISLEM = 2;

sharp.concurrency(1);
const cozmeKilidi = new Semafor(ESZAMANLI_ISLEM);

/** Çözülemeyen, desteklenmeyen biçimdeki ya da sınırı aşan içerik fırlatır. */
export async function normalizeImage(girdi: Buffer): Promise<Buffer> {
  return cozmeKilidi.calistir(async () => {
    const gorsel = sharp(girdi, { failOn: "error", limitInputPixels: PIKSEL_SINIRI });
    const { format } = await gorsel.metadata();
    if (!format || !KABUL_EDILEN_BICIMLER.has(format)) {
      throw new Error(`desteklenmeyen gorsel bicimi: ${format ?? "bilinmiyor"}`);
    }
    return gorsel
      .rotate()
      .resize({ width: GORSEL_UZUN_KENAR, height: GORSEL_UZUN_KENAR, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_KALITESI, mozjpeg: true })
      .timeout({ seconds: ISLEM_ZAMAN_ASIMI_SN })
      .toBuffer();
  });
}

/**
 * Yükleme yolları için: çözülemeyen içerik 400 `INVALID_FILE_TYPE` olur ve depoya hiçbir şey
 * yazılmaz. `kaynak` log etiketidir (ör. "user", "chat").
 */
export async function normalizeUploadedImage(girdi: Buffer, kaynak: string): Promise<Buffer> {
  try {
    return await normalizeImage(girdi);
  } catch (err) {
    console.warn(`[${kaynak}] gorsel cozulemedi:`, err instanceof Error ? err.message : err);
    throw Errors.INVALID_FILE_TYPE();
  }
}
