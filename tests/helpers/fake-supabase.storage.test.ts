import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

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

  it('list tek seviyeli — alt klasordeki dosyalar donmez', async () => {
    const fake = createFakeSupabase({}, { storage: { photos: ['u/a.jpg', 'u/sub/b.jpg'] } });

    const { data } = await fake.client.storage.from('photos').list('u');

    expect(data?.map((f: { name: string }) => f.name)).toEqual(['a.jpg']);
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
});
