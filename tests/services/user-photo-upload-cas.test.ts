import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeSupabase, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * `uploadPhoto` diziye koşullu ekler (2026-11-14). Eskiden oku-değiştir-yaz idi: admin kaldırması ile
 * aynı anda yükleme olursa kaldırılan URL (dosyası silinmiş) profile geri yazılır, eşzamanlı iki
 * yükleme birbirini ezer ve 6 sınırı aşılabilirdi. Artık çakışmada güncel dizi yeniden okunup
 * tekrar denenir; profile yazılamayan dosya depodan temizlenir.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://fake.supabase.co/storage/v1/object/public/photos/';
const url = (n: number) => `${BASE}${U1}/${n}.jpg`;
const PNG = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();

beforeEach(() => vi.resetModules());

async function kur(photos: string[], options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    { users: [{ id: U1, photos, is_deleted: false }], user_details: [], questions: [] },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const moderateUploadedPhoto = vi.fn(async () => null);
  vi.doMock('../../src/services/photo-moderation.service.js', () => ({ moderateUploadedPhoto }));
  const { userService } = await import('../../src/services/user.service.js');
  const yuklenenler = () => fake.storageUploads.filter((u) => u.bucket === 'photos').map((u) => u.path);
  return { fake, userService, moderateUploadedPhoto, yuklenenler, photosOf: () => fake.table('users')[0].photos as string[] };
}

describe('uploadPhoto — koşullu ekleme', () => {
  it('okuduktan sonra admin bir fotoğraf kaldırdıysa: güncel diziye eklenir, kaldırılan geri GELMEZ', async () => {
    const { userService, photosOf } = await kur([url(1), url(2)], {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(1)]; } }],
    });
    const r = await userService.uploadPhoto(U1, await PNG());
    expect(photosOf()).toEqual([url(1), r.url]);
    expect(r.photos).toEqual([url(1), r.url]);
  });

  it('eşzamanlı başka yükleme diziyi 6\'ya doldurduysa MAX_PHOTOS_REACHED; yeni dosya depodan silinir', async () => {
    const alti = [1, 2, 3, 4, 5, 6].map(url);
    const { userService, fake, yuklenenler, photosOf, moderateUploadedPhoto } = await kur(alti.slice(0, 5), {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = alti; } }],
    });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'MAX_PHOTOS_REACHED' });
    expect(photosOf()).toEqual(alti);
    expect(yuklenenler()).toHaveLength(1);
    expect(fake.storageFiles('photos')).not.toContain(yuklenenler()[0]);
    expect(moderateUploadedPhoto).not.toHaveBeenCalled();
  });

  it('her denemede dizi değişirse 3 denemeden sonra PHOTOS_CHANGED; dosya silinir, dizi ezilmez', async () => {
    const { userService, fake, yuklenenler, photosOf } = await kur([url(1), url(2)], {
      interleave: [{ table: 'users', times: 3, mutate: (rows) => { rows[0].photos = [...rows[0].photos].reverse(); } }],
    });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'PHOTOS_CHANGED', statusCode: 409 });
    expect(photosOf()).toEqual([url(2), url(1)]);
    expect(fake.storageFiles('photos')).not.toContain(yuklenenler()[0]);
  });

  it('iki çakışmadan sonra üçüncü denemede yazılır (yeniden deneme sınırı 3)', async () => {
    const { userService, photosOf } = await kur([url(1), url(2)], {
      interleave: [{ table: 'users', times: 2, mutate: (rows) => { rows[0].photos = [...rows[0].photos].reverse(); } }],
    });
    const r = await userService.uploadPhoto(U1, await PNG());
    expect(photosOf()).toEqual([url(1), url(2), r.url]);
  });

  it('okuduktan sonra hesap silindiyse USER_NOT_FOUND; dosya silinir', async () => {
    const { userService, fake, yuklenenler } = await kur([url(1)], {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].is_deleted = true; } }],
    });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(fake.storageFiles('photos')).not.toContain(yuklenenler()[0]);
  });

  it('profil yazımı DB hatasıyla patlarsa SERVER_ERROR; dosya depoda sahipsiz kalmaz', async () => {
    const { userService, fake, yuklenenler, photosOf } = await kur([url(1)], {
      failOn: [{ table: 'users', op: 'update' }],
    });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(photosOf()).toEqual([url(1)]);
    expect(fake.storageFiles('photos')).not.toContain(yuklenenler()[0]);
  });

  it('yazım commit olup cevap koptuysa (belirsiz): profile bakılır, URL oradaysa BAŞARI — dosya silinmez, moderasyon çalışır', async () => {
    const { userService, fake, yuklenenler, photosOf, moderateUploadedPhoto } = await kur([url(1)], {
      failOn: [{ table: 'users', op: 'update', committed: true }],
    });
    const r = await userService.uploadPhoto(U1, await PNG());
    expect(photosOf()).toEqual([url(1), r.url]);
    expect(r.photos).toEqual([url(1), r.url]);
    expect(fake.storageFiles('photos')).toContain(yuklenenler()[0]);
    expect(moderateUploadedPhoto).toHaveBeenCalledWith(U1, r.url);
  });

  it('belirsiz yazımdan sonra doğrulama okuması da patlarsa: hata fırlar ama dosya SİLİNMEZ (kırık foto riski yok)', async () => {
    const { userService, fake, yuklenenler } = await kur([url(1)], {
      failOn: [
        { table: 'users', op: 'update', committed: true },
        { table: 'users', op: 'select', failAfter: 1 },
      ],
    });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.storageFiles('photos')).toContain(yuklenenler()[0]);
  });

  it('okuma DB hatası "kullanıcı yok" sayılmaz: SERVER_ERROR, depoya hiç yazılmaz', async () => {
    const { userService, yuklenenler } = await kur([url(1)], { failOn: [{ table: 'users', op: 'select' }] });
    await expect(userService.uploadPhoto(U1, await PNG())).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(yuklenenler()).toHaveLength(0);
  });
});
