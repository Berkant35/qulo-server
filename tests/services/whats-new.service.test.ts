import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Row } from '../helpers/fake-supabase.js';

const entry = (title: string) => ({ title, body: `${title} gövde`, cta_label: '' });
const satir = (o: Row): Row => ({
  id: 'id', app_version: '2.2.0', platform: 'all', content: { en: entry('EN') },
  image_url: null, is_active: true, ...o,
});

async function setup(rows: Row[], options = {}) {
  const fake = createFakeSupabase({ whats_new: rows }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const mod = await import('../../src/services/whats-new.service.js');
  return { fake, ...mod };
}

beforeEach(() => vi.resetModules());

describe('whatsNewService.getForClient — seçim kuralı', () => {
  it('platforma özel kayıt all kaydına tercih edilir', async () => {
    const { whatsNewService } = await setup([
      satir({ id: 'all', platform: 'all', content: { en: entry('ALL') } }),
      satir({ id: 'ios', platform: 'ios', content: { en: entry('IOS') } }),
    ]);
    expect((await whatsNewService.getForClient('2.2.0', 'ios', 'en'))?.id).toBe('ios');
    expect((await whatsNewService.getForClient('2.2.0', 'android', 'en'))?.id).toBe('all');
  });

  it('pasif kayıt dönmez', async () => {
    const { whatsNewService } = await setup([satir({ is_active: false })]);
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'en')).toBeNull();
  });

  it('farklı sürüm dönmez (tam eşleşme)', async () => {
    const { whatsNewService } = await setup([satir({ app_version: '2.2.0' })]);
    expect(await whatsNewService.getForClient('2.2.1', 'ios', 'en')).toBeNull();
    expect(await whatsNewService.getForClient('2.1.0', 'ios', 'en')).toBeNull();
  });

  it('diğer platforma özel kayıt dönmez', async () => {
    const { whatsNewService } = await setup([satir({ platform: 'ios' })]);
    expect(await whatsNewService.getForClient('2.2.0', 'android', 'en')).toBeNull();
  });

  it('istenen dil varsa o, yoksa en; yanıt şeması', async () => {
    const { whatsNewService } = await setup([
      satir({
        id: 'x', image_url: 'https://x.com/a.png',
        content: { en: entry('EN'), tr: { title: 'TR', body: 'tr gövde', cta_label: 'Tamam' } },
      }),
    ]);
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'tr')).toEqual({
      id: 'x', version: '2.2.0', title: 'TR', body: 'tr gövde', ctaLabel: 'Tamam', imageUrl: 'https://x.com/a.png',
    });
    const de = await whatsNewService.getForClient('2.2.0', 'ios', 'de');
    expect(de).toMatchObject({ title: 'EN', ctaLabel: null });
  });

  it('istenen dilde yarım kayıt (metin yok) en yedeğine düşer', async () => {
    const { whatsNewService } = await setup([
      satir({ content: { en: entry('EN'), tr: { title: 'TR', body: '' } } }),
    ]);
    expect((await whatsNewService.getForClient('2.2.0', 'ios', 'tr'))?.title).toBe('EN');
  });

  it('okuma hatasında null döner (mobil sessiz geçer) ve hata önbelleğe yazılmaz', async () => {
    const { whatsNewService, fake } = await setup([satir({})], {
      failOn: [{ table: 'whats_new', op: 'select', times: 1 }],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'en')).toBeNull();
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'en')).not.toBeNull();
    expect(fake.queries.filter((q) => q.table === 'whats_new')).toHaveLength(2);
  });
});

describe('whatsNewService — önbellek', () => {
  it('art arda iki çağrıda (farklı sürüm/dil dahil) tek DB sorgusu', async () => {
    const { whatsNewService, fake } = await setup([satir({})]);
    await whatsNewService.getForClient('2.2.0', 'ios', 'en');
    await whatsNewService.getForClient('2.2.0', 'android', 'tr');
    await whatsNewService.getForClient('9.9.9', 'ios', 'en');
    expect(fake.queries.filter((q) => q.table === 'whats_new' && q.op === 'select')).toHaveLength(1);
  });

  it('admin yazımı önbelleği temizler (toggle sonrası pasif kayıt hemen kaybolur)', async () => {
    const { whatsNewService } = await setup([satir({ id: 'a' })]);
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'en')).not.toBeNull();
    await whatsNewService.toggleActive('a');
    expect(await whatsNewService.getForClient('2.2.0', 'ios', 'en')).toBeNull();
  });
});

describe('whatsNewService — admin yazımı', () => {
  const input = {
    app_version: '2.2.0', platform: 'ios' as const, content: { en: { title: 'a', body: 'b', cta_label: '' } },
    image_url: null, is_active: true,
  };

  it('create created_by yazar', async () => {
    const { whatsNewService, fake } = await setup([]);
    await whatsNewService.create(input, 'admin-1');
    expect(fake.table('whats_new')[0]).toMatchObject({ app_version: '2.2.0', created_by: 'admin-1' });
  });

  it('aktif (sürüm, platform) çakışması WhatsNewConflictError olur', async () => {
    const { whatsNewService, WhatsNewConflictError } = await setup([], { unique: { whats_new: ['app_version,platform'] } });
    await whatsNewService.create(input, 'admin-1');
    await expect(whatsNewService.create(input, 'admin-1')).rejects.toBeInstanceOf(WhatsNewConflictError);
  });
});
