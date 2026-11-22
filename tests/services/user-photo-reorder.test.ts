import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { updateProfileSchema } from '../../src/validators/user.validator.js';

/**
 * Mobil sürükle-bırak sıralaması `PATCH /users/me { photos }` (qulov2 `reorderPhotos`).
 * 2026-04-01 güvenlik düzeltmesi (3cfac1a) `photos`'u şemadan çıkardı: istemci profile rastgele URL
 * yazamasın. Yan etki: şema alanı atıyor, gövde boş kalıyor, PostgREST boş PATCH'i `SELECT … WHERE false`
 * yapıyor (sıfır satır) → updateProfile 404 USER_NOT_FOUND; sıralama ~7,5 ay hiç kaydedilmedi.
 * Düzeltme (2026-11-14): `photos` yalnız profildeki fotoğrafların YENİDEN SIRALANMIŞI olarak kabul
 * edilir — eklenen/çıkan/yabancı URL reddedilir (güvenlik niyeti korunur); yazım koşullu (CAS).
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://fake.supabase.co/storage/v1/object/public/photos/';
const url = (n: number) => `${BASE}${U1}/${n}.jpg`;
const YABANCI = `${BASE}99999999-9999-4999-8999-999999999999/x.jpg`;

beforeEach(() => vi.resetModules());

async function kur(photos: string[], options: FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(
    { users: [{ id: U1, name: 'Ayşe', photos, is_deleted: false, preferred_languages: ['tr'], locale: 'tr' }], user_details: [], questions: [] },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userService } = await import('../../src/services/user.service.js');
  const satir = () => fake.table('users')[0] as { photos: string[]; name: string };
  // Rota zinciri: `validate(updateProfileSchema)` gövdeyi şemadan geçmiş haliyle değiştirir.
  const guncelle = (body: unknown) => userService.updateProfile(U1, updateProfileSchema.parse(body));
  return { fake, userService, satir, guncelle };
}

describe('updateProfileSchema — photos', () => {
  it('photos alanı şemadan geçer (atılmaz); en fazla 6 öğe', () => {
    expect(updateProfileSchema.parse({ photos: [url(2), url(1)] })).toEqual({ photos: [url(2), url(1)] });
    expect(updateProfileSchema.safeParse({ photos: [1, 2, 3, 4, 5, 6, 7].map(url) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ photos: [42] }).success).toBe(false);
  });

  it('photos başka alanla aynı istekte gelemez (yarım güncelleme olmasın); tek başına geçer', () => {
    expect(updateProfileSchema.safeParse({ photos: [url(2), url(1)], name: 'Ece' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ photos: [url(2), url(1)] }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: 'Ece', bio: 'x' }).success).toBe(true);
  });
});

describe('userService.updateProfile — fotoğraf sıralaması', () => {
  it('yalnız photos gönderilince sıra yazılır ve profil döner (eskiden 404 USER_NOT_FOUND)', async () => {
    const { guncelle, satir } = await kur([url(1), url(2), url(3)]);
    const r = await guncelle({ photos: [url(3), url(1), url(2)] });
    expect(satir().photos).toEqual([url(3), url(1), url(2)]);
    expect(r).toMatchObject({ id: U1, photos: [url(3), url(1), url(2)] });
  });

  it.each([
    ['yabancı URL eklenmiş', [url(1), url(2), YABANCI]],
    ['yabancı URL ile değiştirilmiş', [url(1), YABANCI]],
    ['fotoğraf eksik', [url(1)]],
    ['aynı fotoğraf iki kez', [url(1), url(1)]],
  ])('%s → INVALID_PHOTO_ORDER; dizi değişmez', async (_ad, photos) => {
    const { guncelle, satir } = await kur([url(1), url(2)]);
    await expect(guncelle({ photos })).rejects.toMatchObject({ code: 'INVALID_PHOTO_ORDER', statusCode: 400 });
    expect(satir().photos).toEqual([url(1), url(2)]);
  });

  it('sıra zaten aynıysa hata yok, dizi aynı kalır', async () => {
    const { guncelle, satir } = await kur([url(1), url(2)]);
    await guncelle({ photos: [url(1), url(2)] });
    expect(satir().photos).toEqual([url(1), url(2)]);
  });

  it('okuduktan sonra başka bir sıralama araya girdiyse yeniden okunup istenen sıra yazılır', async () => {
    const { guncelle, satir } = await kur([url(1), url(2), url(3)], {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(2), url(3), url(1)]; } }],
    });
    await guncelle({ photos: [url(3), url(2), url(1)] });
    expect(satir().photos).toEqual([url(3), url(2), url(1)]);
  });

  it('okuduktan sonra fotoğraf eklendi/kaldırıldıysa PHOTOS_CHANGED (409); araya gireni ezmez', async () => {
    const { guncelle, satir } = await kur([url(1), url(2)], {
      interleave: [{ table: 'users', mutate: (rows) => { rows[0].photos = [url(1), url(2), url(3)]; } }],
    });
    await expect(guncelle({ photos: [url(2), url(1)] })).rejects.toMatchObject({ code: 'PHOTOS_CHANGED', statusCode: 409 });
    expect(satir().photos).toEqual([url(1), url(2), url(3)]);
  });
});
