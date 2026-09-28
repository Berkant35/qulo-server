import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Yuklenen gorsel depoya JPEG olarak ve 30 gunluk istemci onbellegiyle yazilir (2026-09-28 maliyet
 * incelemesi): mobil kirpma PNG'yi `image/jpeg` beyaniyla yolluyordu (8 kat buyuk) ve cacheControl
 * hic verilmiyordu (telefon saatte bir yeniden dogruluyordu). Cozulemeyen icerik depoya YAZILMAZ.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const JPEG_IMZA = 'ffd8ff';
const imza = (b: unknown) => (b as Buffer).subarray(0, 3).toString('hex');
const PNG = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();
const COP = Buffer.from('<html>resim degil</html>');

beforeEach(() => vi.resetModules());

async function kullaniciKur(photos: string[] = []) {
  const fake = createFakeSupabase({ users: [{ id: U1, photos, is_deleted: false }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const moderateUploadedPhoto = vi.fn(async () => null);
  vi.doMock('../../src/services/photo-moderation.service.js', () => ({ moderateUploadedPhoto }));
  const { userService } = await import('../../src/services/user.service.js');
  return { fake, userService, moderateUploadedPhoto };
}

async function sohbetKur(medyaAcik = true) {
  const fake = createFakeSupabase({
    matches: [{
      id: MATCH, user1_id: U1, user2_id: U2, is_active: true,
      media_enabled_by_user1: medyaAcik, media_enabled_by_user2: medyaAcik,
    }],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { chatService } = await import('../../src/services/chat.service.js');
  return { fake, chatService };
}

describe('uploadPhoto normalizasyonu', () => {
  it('JPEG beyanli PNG depoya gercek JPEG, .jpg yolu ve 30 gunluk onbellekle yazilir', async () => {
    const { fake, userService } = await kullaniciKur();

    const r = await userService.uploadPhoto(U1, await PNG());

    expect(fake.storageUploads).toHaveLength(1);
    const [y] = fake.storageUploads;
    expect(y.bucket).toBe('photos');
    expect(y.path).toMatch(new RegExp(`^${U1}/\\d+\\.jpg$`));
    expect(imza(y.body)).toBe(JPEG_IMZA);
    expect(y.opts).toMatchObject({ contentType: 'image/jpeg', cacheControl: '2592000', upsert: false });
    expect(r.photos).toEqual([r.url]);
    expect(fake.table('users')[0].photos).toEqual([r.url]);
    // Kalicilik gercekten bir `users` yazimiyla (fake derin kopyalar; dizi degisikligi depoya sizmaz).
    expect(fake.queries).toContainEqual({ table: 'users', op: 'update' });
  });

  it('foto siniri (6) CPU gerektiren cozmeden ONCE uygulanir: MAX_PHOTOS_REACHED, depoya bir sey yazilmaz', async () => {
    const { fake, userService } = await kullaniciKur(Array.from({ length: 6 }, (_, i) => `https://x/${i}.jpg`));

    await expect(userService.uploadPhoto(U1, COP)).rejects.toMatchObject({ code: 'MAX_PHOTOS_REACHED' });

    expect(fake.storageUploads).toEqual([]);
  });

  it('cozulemeyen icerik INVALID_FILE_TYPE (400) alir; depoya ve profile hicbir sey yazilmaz, tarama tetiklenmez', async () => {
    const { fake, userService, moderateUploadedPhoto } = await kullaniciKur();

    await expect(userService.uploadPhoto(U1, COP)).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE', statusCode: 400 });

    expect(fake.storageUploads).toEqual([]);
    expect(fake.table('users')[0].photos).toEqual([]);
    expect(moderateUploadedPhoto).not.toHaveBeenCalled();
  });
});

describe('uploadMedia normalizasyonu (sohbet)', () => {
  it('gorsel JPEG olarak ve 30 gunluk onbellekle yazilir', async () => {
    const { fake, chatService } = await sohbetKur();

    await chatService.uploadMedia(U1, MATCH, await PNG(), 'image/png');

    const [y] = fake.storageUploads;
    expect(y.bucket).toBe('chat-media');
    expect(y.path).toMatch(new RegExp(`^${MATCH}/\\d+\\.jpg$`));
    expect(imza(y.body)).toBe(JPEG_IMZA);
    expect(y.opts).toMatchObject({ contentType: 'image/jpeg', cacheControl: '2592000', upsert: false });
  });

  it('soru-yukleme yolu (skipMediaCheck, medya kapali) de normalize eder; cozulemeyen 400', async () => {
    // chat.controller uploadQuestionMediaHandler medya iznini atlar ama gorsel yine JPEG'e iner.
    const { fake, chatService } = await sohbetKur(false);

    await chatService.uploadMedia(U1, MATCH, await PNG(), 'image/png', { skipMediaCheck: true });
    await expect(chatService.uploadMedia(U1, MATCH, COP, 'image/png', { skipMediaCheck: true }))
      .rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });

    expect(fake.storageUploads).toHaveLength(1);
    expect(imza(fake.storageUploads[0].body)).toBe(JPEG_IMZA);
  });

  it('ses dosyasina dokunulmaz: ayni bayt, beyan edilen tur, .m4a', async () => {
    // Icerik dogrulamasi YOK (beyan edilen audio/* olduğu gibi yazilir) — backlog: magic byte
    // kontrolu iki platformun kayit ciktisi cihazda dogrulanmadan eklenmez.
    const { fake, chatService } = await sohbetKur();
    const ses = Buffer.from('ses-baytlari');

    await chatService.uploadMedia(U1, MATCH, ses, 'audio/mp4');

    const [y] = fake.storageUploads;
    expect(y.body).toBe(ses);
    expect(y.path).toMatch(/\.m4a$/);
    expect(y.opts).toMatchObject({ contentType: 'audio/mp4', cacheControl: '2592000' });
  });

  it('cozulemeyen gorsel INVALID_FILE_TYPE alir ve depoya yazilmaz', async () => {
    const { fake, chatService } = await sohbetKur();

    await expect(chatService.uploadMedia(U1, MATCH, COP, 'image/jpeg')).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });

    expect(fake.storageUploads).toEqual([]);
  });
});
