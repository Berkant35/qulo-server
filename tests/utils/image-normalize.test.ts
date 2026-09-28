import { describe, it, expect, vi } from 'vitest';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { normalizeImage, normalizeUploadedImage, GORSEL_UZUN_KENAR } from '../../src/utils/image-normalize.js';

const JPEG_IMZA = 'ffd8ff';
const imza = (b: Buffer) => b.subarray(0, 3).toString('hex');

/**
 * Fotograf benzeri RGB goruntu: yumusak gradyan + rastgele gren. Periyodik desen KULLANMA —
 * PNG onu cok iyi sikistirir, gercek fotografi temsil etmez.
 */
async function gurultu(w: number, h: number) {
  let t = 12345;
  const rnd = () => { t = (Math.imul(t, 1103515245) + 12345) >>> 0; return (t >>> 16) & 0x1f; };
  const piksel = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      piksel[i] = Math.floor((x * 200) / w) + rnd();
      piksel[i + 1] = Math.floor((y * 200) / h) + rnd();
      piksel[i + 2] = 120 + rnd();
    }
  }
  return sharp(piksel, { raw: { width: w, height: h, channels: 3 } });
}

describe('normalizeImage', () => {
  it('JPEG beyanli PNG (mobil kirpma ciktisi) gercek JPEG olur ve kuculur', async () => {
    const png = await (await gurultu(600, 800)).png().toBuffer();
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');

    const cikti = await normalizeImage(png);

    expect(imza(cikti)).toBe(JPEG_IMZA);
    expect(cikti.length).toBeLessThan(png.length);
    const meta = await sharp(cikti).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
  });

  it('uzun kenar siniri asilirsa oran korunarak kucultulur', async () => {
    const buyuk = await (await gurultu(1500, 2000)).jpeg().toBuffer();
    const meta = await sharp(await normalizeImage(buyuk)).metadata();
    expect(meta.height).toBe(GORSEL_UZUN_KENAR);
    expect(meta.width).toBe(1080);
  });

  it('kucuk goruntu buyutulmez', async () => {
    const kucuk = await (await gurultu(200, 100)).png().toBuffer();
    const meta = await sharp(await normalizeImage(kucuk)).metadata();
    expect([meta.width, meta.height]).toEqual([200, 100]);
  });

  it('EXIF yonu uygulanir ve metadata (EXIF/GPS) ciktiya yazilmaz', async () => {
    // 6 = 90° saat yonunde: 300x200 depolanan goruntu dikey (200x300) gosterilmeli.
    const exifli = await (await gurultu(300, 200)).jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const girdiMeta = await sharp(exifli).metadata();
    expect(girdiMeta.orientation).toBe(6);
    expect(girdiMeta.exif).toBeDefined();

    const meta = await sharp(await normalizeImage(exifli)).metadata();

    expect([meta.width, meta.height]).toEqual([200, 300]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('seffaf PNG beyaz zemine duser', async () => {
    const seffaf = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(await normalizeImage(seffaf)).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(240);
  });

  it('resim olmayan bayt reddedilir', async () => {
    await expect(normalizeImage(Buffer.from('x'.repeat(100)))).rejects.toThrow();
  });

  it('SVG (image/png beyaniyla gelse de) CIZILMEDEN reddedilir', async () => {
    // Review 2026-09-28: 294 baytlik filtreli SVG 20 sn CPU yakiyordu. Bicim baslikta okunur.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="3000"><filter id="f">' +
      '<feMorphology radius="200"/><feMorphology radius="200"/><feMorphology radius="200"/></filter>' +
      '<rect width="3000" height="3000" filter="url(#f)"/></svg>',
    );
    const t0 = Date.now();
    await expect(normalizeImage(svg)).rejects.toThrow(/desteklenmeyen gorsel bicimi: svg/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('JPEG/PNG/WebP disi bicim (TIFF, GIF) reddedilir; WebP kabul edilir', async () => {
    const kaynak = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#39c' } });
    await expect(normalizeImage(await kaynak().tiff().toBuffer())).rejects.toThrow(/tiff/);
    await expect(normalizeImage(await kaynak().gif().toBuffer())).rejects.toThrow(/gif/);
    expect(imza(await normalizeImage(await kaynak().webp().toBuffer()))).toBe(JPEG_IMZA);
  });

  it('piksel siniri: yalniz basligi buyuk boyut beyan eden PNG (bomba) cozulmeden reddedilir', async () => {
    // 6000x5000 = 30 MP > 25 MP; IDAT yalniz ilk satiri tasir (dosya ~100 bayt). Sinir baslik
    // okununca tetiklenmeli — piksel verisi icin bellek ayrilmadan.
    const chunk = (tip: string, veri: Buffer) => {
      const tipVeri = Buffer.concat([Buffer.from(tip, 'ascii'), veri]);
      const uzunluk = Buffer.alloc(4); uzunluk.writeUInt32BE(veri.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(tipVeri));
      return Buffer.concat([uzunluk, tipVeri, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(6000, 0); ihdr.writeUInt32BE(5000, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8 bit RGB
    const bomba = Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(Buffer.alloc(1 + 6000 * 3))), chunk('IEND', Buffer.alloc(0)),
    ]);
    await expect(normalizeImage(bomba)).rejects.toThrow(/pixel limit/i);
  });
});

describe('normalizeUploadedImage', () => {
  it('cozulemeyen icerik INVALID_FILE_TYPE (400) olur', async () => {
    const uyari = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(normalizeUploadedImage(Buffer.from('degil'), 'test')).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE', statusCode: 400 });
    expect(uyari).toHaveBeenCalledWith('[test] gorsel cozulemedi:', expect.any(String));
    uyari.mockRestore();
  });
});
