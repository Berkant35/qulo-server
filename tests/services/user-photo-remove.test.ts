import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Fotoğraf kaldırma çekirdeği — kullanıcının kendi silmesi (`deletePhoto`, indeks) ve backoffice
 * kaldırması (`removePhotosByUrl`, URL) aynı yoldan geçer (2026-11-14). Admin URL ile seçer: sayfa
 * açıkken kullanıcı sıralamayı değiştirirse indeks yanlış fotoğrafı silerdi. Sıra: önce profil
 * satırı, sonra depo — satır yazımı patlarsa dosya silinmiş, profilde kırık fotoğraf kalmasın.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://fake.supabase.co/storage/v1/object/public/photos/';
const path = (n: number) => `${U1}/${n}.jpg`;
const url = (n: number) => `${BASE}${path(n)}`;
const DIS = 'https://images.example.com/seed-face.jpg';

beforeEach(() => vi.resetModules());

async function kur(photos: string[], opts: { is_deleted?: boolean; fake?: FakeSupabaseOptions } = {}) {
  const fake = createFakeSupabase(
    { users: [{ id: U1, photos, is_deleted: opts.is_deleted ?? false }], user_details: [], questions: [] },
    { storage: { photos: [path(1), path(2), path(3)] }, ...opts.fake },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userService } = await import('../../src/services/user.service.js');
  return { fake, userService, photosOf: () => fake.table('users')[0].photos as string[] };
}

describe('userService.removePhotosByUrl (backoffice)', () => {
  it('yalnız seçilen URL kalkar; kalanların sırası korunur; dosyası depodan silinir', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2), url(3)]);
    const r = await userService.removePhotosByUrl(U1, [url(2)]);
    expect(r).toEqual({ photos: [url(1), url(3)], removed: [url(2)] });
    expect(photosOf()).toEqual([url(1), url(3)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(3)]);
  });

  it('birden fazla fotoğraf tek seferde kalkar (ana fotoğraf dahil → sıradaki ana olur)', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2), url(3)]);
    const r = await userService.removePhotosByUrl(U1, [url(1), url(3)]);
    expect(r.removed).toEqual([url(1), url(3)]);
    expect(photosOf()).toEqual([url(2)]);
    expect(fake.storageFiles('photos')).toEqual([path(2)]);
  });

  it('profilde olmayan URL yok sayılır, profildeki kaldırılır (kısmen bayat sayfa)', async () => {
    const { userService, photosOf } = await kur([url(1), url(2)]);
    const r = await userService.removePhotosByUrl(U1, [url(9), url(1)]);
    expect(r.removed).toEqual([url(1)]);
    expect(photosOf()).toEqual([url(2)]);
  });

  it('hiçbiri profilde değilse PHOTO_NOT_FOUND; profil ve depo değişmez', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2)]);
    await expect(userService.removePhotosByUrl(U1, [url(9)])).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND', statusCode: 404 });
    expect(photosOf()).toEqual([url(1), url(2)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2), path(3)]);
  });

  it('silinmiş hesapta USER_NOT_FOUND (hesap temizliği ayrı yol)', async () => {
    const { userService, photosOf } = await kur([url(1)], { is_deleted: true });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(photosOf()).toEqual([url(1)]);
  });

  it('depo dışı (seed/harici) URL profilden kalkar, depoya dokunulmaz', async () => {
    const { userService, fake, photosOf } = await kur([DIS, url(1)]);
    await userService.removePhotosByUrl(U1, [DIS]);
    expect(photosOf()).toEqual([url(1)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2), path(3)]);
  });

  it('profil yazımı patlarsa SERVER_ERROR ve dosya depoda KALIR (kırık fotoğraf yok)', async () => {
    const { userService, fake } = await kur([url(1), url(2)], {
      fake: { storage: { photos: [path(1), path(2)] }, failOn: [{ table: 'users', op: 'update' }] },
    });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2)]);
  });

  it('depo silmesi patlarsa profil yine güncellenir, hata fırlatılmaz (sahipsiz dosya kalır)', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2)], {
      fake: { storage: { photos: [path(1), path(2)] }, storageFailOn: [{ bucket: 'photos', op: 'remove' }] },
    });
    const r = await userService.removePhotosByUrl(U1, [url(1)]);
    expect(r.removed).toEqual([url(1)]);
    expect(photosOf()).toEqual([url(2)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2)]);
  });

  it('okuma hatası "kullanıcı yok" sayılmaz: SERVER_ERROR', async () => {
    const { userService, photosOf } = await kur([url(1)], { fake: { failOn: [{ table: 'users', op: 'select' }] } });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(photosOf()).toEqual([url(1)]);
  });

  it('başka kullanıcının klasöründeki dosya (paylaşılan seed kopyası) depoda kalır, profilden kalkar', async () => {
    const BASKA = '99999999-9999-4999-8999-999999999999/x.jpg';
    const { userService, fake, photosOf } = await kur([`${BASE}${BASKA}`, url(1)], {
      fake: { storage: { photos: [BASKA, path(1)] } },
    });
    await userService.removePhotosByUrl(U1, [`${BASE}${BASKA}`]);
    expect(photosOf()).toEqual([url(1)]);
    expect(fake.storageFiles('photos')).toEqual([BASKA, path(1)]);
  });
});

describe('koşullu yazım (compare-and-swap) — eşzamanlı değişiklik ezilmez', () => {
  it('okuduktan sonra kullanıcı fotoğraf yüklediyse PHOTOS_CHANGED; yeni fotoğraf kalır, depoya dokunulmaz', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2)], {
      fake: {
        storage: { photos: [path(1), path(2)] },
        interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(1), url(2), url(3)]; } }],
      },
    });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'PHOTOS_CHANGED', statusCode: 409 });
    expect(photosOf()).toEqual([url(1), url(2), url(3)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2)]);
  });

  it('okuduktan sonra sıralama değiştiyse de PHOTOS_CHANGED (dizi sıra duyarlı karşılaştırılır)', async () => {
    const { userService, photosOf } = await kur([url(1), url(2)], {
      fake: { interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(2), url(1)]; } }] },
    });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'PHOTOS_CHANGED' });
    expect(photosOf()).toEqual([url(2), url(1)]);
  });

  it('okuduktan sonra hesap silindiyse yazılmaz, dosya silinmez', async () => {
    const { userService, fake, photosOf } = await kur([url(1)], {
      fake: {
        storage: { photos: [path(1)] },
        interleave: [{ table: 'users', mutate: (rows) => { rows[0].is_deleted = true; } }],
      },
    });
    await expect(userService.removePhotosByUrl(U1, [url(1)])).rejects.toMatchObject({ code: 'PHOTOS_CHANGED' });
    expect(photosOf()).toEqual([url(1)]);
    expect(fake.storageFiles('photos')).toEqual([path(1)]);
  });
});

describe('userService.deletePhoto (mobil, indeks) — ortak çekirdeğe taşındı', () => {
  it('indeksteki fotoğraf ve dosyası silinir; yanıt biçimi { photos } aynen', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(2), url(3)]);
    const r = await userService.deletePhoto(U1, 0);
    expect(r).toEqual({ photos: [url(2), url(3)] });
    expect(photosOf()).toEqual([url(2), url(3)]);
    expect(fake.storageFiles('photos')).toEqual([path(2), path(3)]);
  });

  it.each([-1, 3])('geçersiz indeks %i → INVALID_PHOTO_INDEX, hiçbir şey değişmez', async (i) => {
    const { userService, fake, photosOf } = await kur([url(1), url(2), url(3)]);
    await expect(userService.deletePhoto(U1, i)).rejects.toMatchObject({ code: 'INVALID_PHOTO_INDEX' });
    expect(photosOf()).toEqual([url(1), url(2), url(3)]);
    expect(fake.storageFiles('photos')).toEqual([path(1), path(2), path(3)]);
  });

  it('aynı URL iki kez kayıtlıysa biri silinir, profilde kalanın dosyası silinmez', async () => {
    const { userService, fake, photosOf } = await kur([url(1), url(1), url(2)]);
    await userService.deletePhoto(U1, 0);
    expect(photosOf()).toEqual([url(1), url(2)]);
    expect(fake.storageFiles('photos')).toContain(path(1));
  });
});
