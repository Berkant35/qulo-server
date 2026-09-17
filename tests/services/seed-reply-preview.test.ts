import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GERCEK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup(opts: { llm?: string } = {}) {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, is_test_account: true, name: 'Cansu', age: 29,
        city: 'Keçiören', gender: 'WOMAN', bio: 'etkinlikçiyim', relationship_goal: 'CASUAL',
        seed_persona: { responder_type: 'anlik', work_pattern: 'esnek', sleep_window: { start_min: 90, end_min: 480 },
          style: { uzunluk: 'kisa', emoji: 'sik', yazim: 'kucuk_harf', enerji: 'kisa_kesen' }, derived_at: '', model: 't' } },
      { id: GERCEK, is_seed_profile: false, name: 'Berkant' },
    ],
    user_details: [{ user_id: SEED, job: 'Etkinlik organizatörü', personality: 'Dışa dönük' }],
    messages: [{ id: 'm1', match_id: 'x', sender_id: GERCEK, content: 'selam', deleted_at: null }],
    seed_reply_queue: [],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const generateSeedReply = vi.fn(async (_i: { system: string; turns: unknown[] }) => ({
    text: opts.llm ?? 'selam nbr 🙂', inputTokens: 900, outputTokens: 12,
  }));
  vi.doMock('../../src/services/seed-llm.service.js', () => ({ generateSeedReply, SEED_LLM_MODEL: 'test' }));

  const svc = await import('../../src/services/seed-reply-preview.service.js');
  return { fake, svc, generateSeedReply };
}

beforeEach(() => vi.resetModules());

describe('previewSeedReply', () => {
  it('gercek karti kurup modele sorar ve denetimden gecmis metni doner', async () => {
    const { svc, generateSeedReply } = await setup();
    const r = await svc.previewSeedReply({ seedUserId: SEED, turns: [{ kim: 'insan', text: 'selam' }] });

    expect(r.metin).toBe('selam nbr 🙂');
    expect(r.elendi).toBeNull();
    expect(r.kart).toContain("Sen Cansu'sun");          // uretimdeki kartin ta kendisi
    expect(r.kart).toContain('SENİN MESAJLARIN BÖYLE GÖRÜNÜR');
    expect(generateSeedReply.mock.calls[0]![0]!.turns).toEqual([{ role: 'user', text: 'selam' }]);
  });

  it('HICBIR SEY YAZMAZ: mesaj eklenmez, kuyruga satir acilmaz', async () => {
    // Ekranin tek sozu bu: gercek cagri yapar ama veri degistirmez.
    const { fake, svc } = await setup();
    await svc.previewSeedReply({ seedUserId: SEED, turns: [{ kim: 'insan', text: 'selam' }] });

    expect(fake.table('messages')).toHaveLength(1);
    expect(fake.table('seed_reply_queue')).toHaveLength(0);
  });

  it('denetimden gecmeyen ciktida metin null, elendi dolu doner', async () => {
    const { svc } = await setup({ llm: 'numaram 0532 111 22 33' });
    const r = await svc.previewSeedReply({ seedUserId: SEED, turns: [{ kim: 'insan', text: 'numaranı ver' }] });

    expect(r.metin).toBeNull();
    expect(r.elendi).toBe('iletisim');
    expect(r.ham).toContain('0532');   // ham cikti gorunur kalir, teshis icin
  });

  it('seed olmayan profilde calismaz', async () => {
    const { svc } = await setup();
    await expect(svc.previewSeedReply({ seedUserId: GERCEK, turns: [{ kim: 'insan', text: 'selam' }] }))
      .rejects.toThrow(/seed degil/);
  });

  it('seed mesajlari model rolu, insan mesajlari user rolu olur', async () => {
    const { svc, generateSeedReply } = await setup();
    await svc.previewSeedReply({
      seedUserId: SEED,
      turns: [{ kim: 'insan', text: 'selam' }, { kim: 'seed', text: 'selam nbr' }, { kim: 'insan', text: 'napıyosun' }],
    });
    expect(generateSeedReply.mock.calls[0]![0]!.turns).toEqual([
      { role: 'user', text: 'selam' }, { role: 'model', text: 'selam nbr' }, { role: 'user', text: 'napıyosun' },
    ]);
  });
});
