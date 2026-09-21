import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { presenceFor } from '../../src/services/seed-presence.service.js';
import type { SeedPersona } from '../../src/types/seed-persona.js';

/** Uyku 01:00-07:30 (TR), ofis mesaisi hafta ici 09-18. */
const persona = (over: Partial<SeedPersona> = {}): SeedPersona => ({
  responder_type: 'normal', work_pattern: 'ofis',
  sleep_window: { start_min: 60, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'gevsek', enerji: 'soru_soran' },
  derived_at: '', model: 't', ...over,
});

/** TR yereli UTC+3: verilen TR saatini UTC Date'e cevirir. Carsamba secildi (hafta ici). */
const trSaat = (saat: number, dk = 0) => new Date(Date.UTC(2026, 8, 16, saat - 3, dk));

describe('presenceFor', () => {
  it('uyku penceresinde HICBIR profil cevrimici degil', async () => {
    for (let i = 0; i < 60; i++) {
      const p = presenceFor(persona(), `seed_${i}`, trSaat(3));   // 03:00 TR
      expect(p.online).toBe(false);
      expect(p.gorulmeDk).toBeGreaterThanOrEqual(180);            // uykuya girmeden once
    }
  });

  it('mesai saatinde cevrimicilik nadir (telefona az bakilir)', async () => {
    const n = 200;
    const online = Array.from({ length: n }, (_, i) => presenceFor(persona(), `seed_${i}`, trSaat(11)))
      .filter((p) => p.online).length;
    expect(online).toBeLessThan(n * 0.15);
  });

  it('anlik cevaplayan, gec cevaplayandan DAHA SIK cevrimici', async () => {
    const say = (tip: SeedPersona['responder_type']) =>
      Array.from({ length: 300 }, (_, i) => presenceFor(persona({ responder_type: tip }), `seed_${i}`, trSaat(20)))
        .filter((p) => p.online).length;
    expect(say('anlik')).toBeGreaterThan(say('gec'));
  });

  it('bos saatte profillerin bir kismi cevrimici, hepsi degil', async () => {
    const hepsi = Array.from({ length: 200 }, (_, i) => presenceFor(persona(), `seed_${i}`, trSaat(20)));
    const online = hepsi.filter((p) => p.online).length;
    expect(online).toBeGreaterThan(0);
    expect(online).toBeLessThan(200);
  });

  it('ayni tik icinde deterministik, tikler arasi degisebilir', async () => {
    const a = presenceFor(persona(), 'seed_7', trSaat(20, 1));
    const b = presenceFor(persona(), 'seed_7', trSaat(20, 3));   // ayni 5 dk dilimi
    expect(a).toEqual(b);
  });

  it('son gorulme 5 dakikanin katina yuvarlanir (toplu guncelleme icin)', async () => {
    for (let i = 0; i < 40; i++) {
      const p = presenceFor(persona(), `seed_${i}`, trSaat(20));
      if (!p.online) expect(p.gorulmeDk % 5).toBe(0);
    }
  });
});

describe('refreshSeedPresence', () => {
  beforeEach(() => vi.resetModules());

  it('tum seed profilleri tazeler, seed olmayanlara DOKUNMAZ', async () => {
    const fake = createFakeSupabase({
      users: [
        { id: 's1', is_seed_profile: true, seed_persona: persona(), is_online: false, last_seen_at: '2026-09-12T10:00:00Z' },
        { id: 's2', is_seed_profile: true, seed_persona: persona({ responder_type: 'anlik' }), is_online: false, last_seen_at: '2026-09-12T10:00:00Z' },
        { id: 'gercek', is_seed_profile: false, is_online: false, last_seen_at: '2026-09-12T10:00:00Z' },
      ],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');

    const n = await refreshSeedPresence(trSaat(20));

    expect(n).toBe(2);
    const satir = (id: string) => fake.table('users').find((u: Record<string, unknown>) => u.id === id)!;
    expect(satir('s1').last_seen_at).not.toBe('2026-09-12T10:00:00Z');
    expect(satir('s2').last_seen_at).not.toBe('2026-09-12T10:00:00Z');
    expect(satir('gercek').last_seen_at).toBe('2026-09-12T10:00:00Z');   // dokunulmadi
  });


  it('son gorulme ASLA geriye gitmez — art arda tiklerde monoton artar', async () => {
    // Eski davranis: her tik bagimsiz bir "kac dk once" cekiyor ve DOGRUDAN yaziyordu.
    // Ayni profile art arda bakan kullanici "2 saat once" -> "10 dk once" ziplamasini
    // goruyordu; gercek hayatta son gorulme yalnizca ileri gider.
    const fake = createFakeSupabase({
      users: Array.from({ length: 40 }, (_, i) => ({
        id: `s${i}`, is_seed_profile: true,
        seed_persona: persona({ work_pattern: 'esnek' }),
        is_online: false,
        last_seen_at: new Date(trSaat(20).getTime() - 30 * 60_000).toISOString(),
      })),
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');

    const oku = () => Object.fromEntries(
      fake.table('users').map((u: Record<string, unknown>) => [u.id, Date.parse(String(u.last_seen_at))]),
    );

    let onceki = oku();
    for (let tik = 0; tik < 12; tik++) {                 // 1 saatlik ritim
      await refreshSeedPresence(trSaat(20, tik * 5));
      const simdi = oku();
      for (const id of Object.keys(onceki)) {
        expect(simdi[id]).toBeGreaterThanOrEqual(onceki[id]!);
      }
      onceki = simdi;
    }
  });

  it('cevrimdisi kalan profilin son gorulmesine DOKUNULMAZ — kendiliginden yaslanir', async () => {
    // Uyku penceresi: hicbir profil cevrimici degil, yani hepsi "cevrimdisi kalan".
    const taze = new Date(trSaat(3).getTime() - 90 * 60_000).toISOString();
    const fake = createFakeSupabase({
      users: [
        { id: 's1', is_seed_profile: true, seed_persona: persona(), is_online: false, last_seen_at: taze },
        { id: 's2', is_seed_profile: true, seed_persona: persona(), is_online: true, last_seen_at: taze },
      ],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');

    await refreshSeedPresence(trSaat(3));

    const satir = (id: string) => fake.table('users').find((u: Record<string, unknown>) => u.id === id)!;
    expect(satir('s1').last_seen_at).toBe(taze);        // zaten cevrimdisiydi: hic yazilmadi
    expect(satir('s2').last_seen_at).toBe(taze);        // cevrimici -> cevrimdisi: yalniz bayrak dustu
    expect(satir('s2').is_online).toBe(false);
  });

  it('cevrimici olan profilin son gorulmesi SIMDI olur', async () => {
    const an = trSaat(20);
    const fake = createFakeSupabase({
      users: Array.from({ length: 60 }, (_, i) => ({
        id: `s${i}`, is_seed_profile: true,
        seed_persona: persona({ responder_type: 'anlik', work_pattern: 'esnek' }),
        is_online: false,
        last_seen_at: new Date(an.getTime() - 120 * 60_000).toISOString(),
      })),
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');

    await refreshSeedPresence(an);

    const cevrimiciler = fake.table('users').filter((u: Record<string, unknown>) => u.is_online);
    expect(cevrimiciler.length).toBeGreaterThan(0);      // anlik tip, bos saat
    for (const u of cevrimiciler) {
      expect(Date.parse(String(u.last_seen_at))).toBe(an.getTime());
    }
  });

  it('bayat son gorulme bir kez tohumlanir (yeni seed partisi "5 gun once goruldu" kalmaz)', async () => {
    const an = trSaat(3);   // uyku penceresi: hicbir profil cevrimici olmaz, tohum yolu kesin
    const fake = createFakeSupabase({
      users: [
        { id: 'bayat', is_seed_profile: true, seed_persona: persona(), is_online: false,
          last_seen_at: new Date(an.getTime() - 5 * 24 * 60 * 60_000).toISOString() },
        { id: 'bos', is_seed_profile: true, seed_persona: persona(), is_online: false, last_seen_at: null },
      ],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');

    await refreshSeedPresence(an);

    for (const id of ['bayat', 'bos']) {
      const u = fake.table('users').find((r: Record<string, unknown>) => r.id === id)!;
      const dk = (an.getTime() - Date.parse(String(u.last_seen_at))) / 60_000;
      expect(dk).toBeGreaterThan(0);
      expect(dk).toBeLessThanOrEqual(12 * 60);          // tohum esigi icinde
    }
  });

  it('seed yoksa no-op', async () => {
    const fake = createFakeSupabase({ users: [{ id: 'g', is_seed_profile: false }] });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { refreshSeedPresence } = await import('../../src/services/seed-presence.service.js');
    expect(await refreshSeedPresence(trSaat(20))).toBe(0);
  });
});
