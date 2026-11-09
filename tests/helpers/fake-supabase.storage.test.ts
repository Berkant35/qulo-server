import { describe, it, expect } from 'vitest';
import { createFakeSupabase, fakeSignedUrl } from './fake-supabase.js';

/**
 * Fake Storage sadakati (2026-09-11, account-purge sohbet medyasi review'i).
 * Gercek `list` sayfali (varsayilan 100) ve tek seviyeli; fake ikisinden de sapiyordu
 * ve `from()` aninda yakalanan dizi `remove` sonrasi bayat kaliyordu. Sapan bir fake,
 * sayfalamayi unutan ya da alt klasoru atlayan kodu testte yesil gosterir.
 */
describe('fake-supabase storage', () => {
  it('list varsayilan 100 dosya doner, limit verilirse o kadar', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `u/${i}.jpg`);
    const fake = createFakeSupabase({}, { storage: { photos: paths } });

    const { data: byDefault } = await fake.client.storage.from('photos').list('u');
    const { data: withLimit } = await fake.client.storage.from('photos').list('u', { limit: 1000 });

    expect(byDefault).toHaveLength(100);
    expect(withLimit).toHaveLength(150);
  });

  // Gercek API alt klasoru `id: null` girdisi olarak doner (FileObject); eskiden fake klasoru hic
  // gostermiyordu — klasorlu yapiyi (question-media `${userId}/${questionId}/`) temizleyen kod sinanamiyordu.
  it('list tek seviyeli — alt klasordeki dosyalar donmez, klasor tek girdi (id: null)', async () => {
    const fake = createFakeSupabase({}, { storage: { photos: ['u/a.jpg', 'u/sub/b.jpg', 'u/sub/c.jpg'] } });

    const { data } = await fake.client.storage.from('photos').list('u');

    expect(data).toEqual([
      { name: 'a.jpg', id: 'fake-file:u/a.jpg' },
      { name: 'sub', id: null },
    ]);
  });

  it('createSignedUrl(s) deterministik URL doner; olmayan dosya hata / satir hatasi', async () => {
    const fake = createFakeSupabase({}, { storage: { 'question-media': ['u/q/a.jpg'] } });
    const bucket = fake.client.storage.from('question-media');

    expect((await bucket.createSignedUrl('u/q/a.jpg', 600)).data).toEqual({ signedUrl: fakeSignedUrl('question-media', 'u/q/a.jpg', 600) });
    expect((await bucket.createSignedUrl('u/q/yok.jpg', 600)).error).not.toBeNull();
    const { data } = await bucket.createSignedUrls(['u/q/a.jpg', 'u/q/yok.jpg'], 600);
    expect(data?.[0]).toEqual({ path: 'u/q/a.jpg', signedUrl: fakeSignedUrl('question-media', 'u/q/a.jpg', 600), error: null });
    expect(data?.[1].error).not.toBeNull();
  });

  it('ayni bucket nesnesiyle ardisik remove/list guncel diziyi gorur', async () => {
    const fake = createFakeSupabase({}, { storage: { photos: ['u/a.jpg', 'u/b.jpg'] } });
    const bucket = fake.client.storage.from('photos');

    await bucket.remove(['u/a.jpg']);
    await bucket.remove(['u/b.jpg']);

    expect(fake.storageFiles('photos')).toEqual([]);
    expect((await bucket.list('u')).data).toEqual([]);
  });

  it('storageFailOn yalnizca hedeflenen cagrilari bozar (failAfter + times)', async () => {
    const fake = createFakeSupabase({}, {
      storage: { photos: ['u/a.jpg'] },
      storageFailOn: [{ bucket: 'photos', op: 'list', failAfter: 1, times: 1 }],
    });
    const list = () => fake.client.storage.from('photos').list('u');

    expect((await list()).error).toBeNull();
    expect((await list()).error).not.toBeNull();
    expect((await list()).error).toBeNull();
  });

  it('upload gövdeyi ve seçenekleri kaydeder; reddedilen (409) yazım kaydedilmez', async () => {
    const fake = createFakeSupabase({}, { storage: { photos: ['u/a.jpg'] } });
    const bucket = fake.client.storage.from('photos');
    const govde = Buffer.from([0xff, 0xd8, 0xff]);

    await bucket.upload('u/b.jpg', govde, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    const { error } = await bucket.upload('u/a.jpg', govde, { upsert: false });

    expect(error?.code).toBe('409');
    expect(fake.storageUploads).toEqual([
      { bucket: 'photos', path: 'u/b.jpg', body: govde, opts: { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false } },
    ]);
  });
});
