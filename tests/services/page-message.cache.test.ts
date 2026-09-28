import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FailureSpec } from '../helpers/fake-supabase.js';
import type { CreatePageMessageInput } from '../../src/validators/page-message.validator.js';

/**
 * Aktif sayfa mesajlari (herkes icin ayni liste) her resume'da okunuyordu. 60 sn surec ici
 * onbellek; admin CRUD'u aninda temizler; tarih araligi her cagrida yeniden suzulur.
 */
const U1 = '11111111-1111-4111-8111-111111111111';

function mesaj(ek: Record<string, unknown> = {}) {
  return {
    id: 'pm1', page: 'discover', display_type: 'banner', content: { tr: { title: 'Merhaba' } },
    image_url: null, action_url: null, frequency: 'every_visit', priority: 1,
    is_active: true, start_at: null, end_at: null, segment: null, ...ek,
  };
}

async function setup(pageMessages: Record<string, unknown>[] = [], failOn?: FailureSpec[]) {
  const fake = createFakeSupabase(
    { page_messages: pageMessages, users: [{ id: U1, gender: 'female', age: 25, city: 'Istanbul' }], page_message_events: [] },
    { failOn },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { pageMessageService } = await import('../../src/services/page-message.service.js');
  const mesajOkumalari = () => fake.queries.filter((q) => q.table === 'page_messages' && q.op === 'select').length;
  return { fake, pageMessageService, mesajOkumalari };
}

beforeEach(() => vi.resetModules());

describe('pageMessageService.getActiveForUser onbellegi', () => {
  it('ardisik cagrilar aktif listeyi tek kez okur', async () => {
    const { pageMessageService, mesajOkumalari } = await setup([mesaj()]);
    expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);
    expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);
    expect(mesajOkumalari()).toBe(1);
  });

  it('60 sn sonra yeniden okur', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-28T10:00:00Z').getTime();
      vi.setSystemTime(T0);
      const { pageMessageService, mesajOkumalari } = await setup([]);
      await pageMessageService.getActiveForUser(U1);
      vi.setSystemTime(T0 + 59_999);
      await pageMessageService.getActiveForUser(U1);
      expect(mesajOkumalari()).toBe(1);
      vi.setSystemTime(T0 + 60_000);
      await pageMessageService.getActiveForUser(U1);
      expect(mesajOkumalari()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('admin create onbellegi temizler — yeni mesaj bir sonraki cagrida gorunur', async () => {
    const { pageMessageService } = await setup([]);
    expect(await pageMessageService.getActiveForUser(U1)).toEqual([]);

    const girdi = { ...mesaj({ id: undefined }) } as unknown as CreatePageMessageInput;
    await pageMessageService.create(girdi, 'admin-1');

    expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);
  });

  it('admin toggleActive / remove onbellegi temizler', async () => {
    const { pageMessageService } = await setup([mesaj()]);
    expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);

    await pageMessageService.toggleActive('pm1');
    expect(await pageMessageService.getActiveForUser(U1)).toEqual([]);

    await pageMessageService.toggleActive('pm1');
    expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);

    await pageMessageService.remove('pm1');
    expect(await pageMessageService.getActiveForUser(U1)).toEqual([]);
  });

  it('admin update onbellegi temizler', async () => {
    const { pageMessageService } = await setup([mesaj()]);
    await pageMessageService.getActiveForUser(U1);

    const yeni = { ...mesaj(), content: { tr: { title: 'Guncel' } } } as unknown as CreatePageMessageInput;
    await pageMessageService.update('pm1', yeni);

    const [m] = await pageMessageService.getActiveForUser(U1);
    expect(m.content).toEqual({ tr: { title: 'Guncel' } });
  });

  it('tarih araligi onbellekten sonra suzulur — biten mesaj TTL beklemeden duser', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-28T10:00:00Z').getTime();
      vi.setSystemTime(T0);
      const { pageMessageService } = await setup([mesaj({ end_at: new Date(T0 + 10_000).toISOString() })]);
      expect(await pageMessageService.getActiveForUser(U1)).toHaveLength(1);

      vi.setSystemTime(T0 + 20_000);
      expect(await pageMessageService.getActiveForUser(U1)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('okuma hatasi SERVER_ERROR olur, loglanir ve onbellege YAZILMAZ', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pageMessageService, mesajOkumalari } = await setup([mesaj()], [{ table: 'page_messages', op: 'select' }]);
    await expect(pageMessageService.getActiveForUser(U1)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    await expect(pageMessageService.getActiveForUser(U1)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(mesajOkumalari()).toBe(2);
    expect(log).toHaveBeenCalledWith('[page-message] aktif liste okunamadi:', expect.any(String));
    log.mockRestore();
  });

  it('olaylar okunamazsa SERVER_ERROR — kapatilmis mesaj "hic gosterilmemis" sanilip yeniden gosterilmez', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { pageMessageService } = await setup(
      [mesaj({ frequency: 'until_dismissed' })],
      [{ table: 'page_message_events', op: 'select' }],
    );
    await expect(pageMessageService.getActiveForUser(U1)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(log).toHaveBeenCalledWith('[page-message] olaylar okunamadi:', expect.any(String));
    log.mockRestore();
  });
});
