import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Fotograf moderasyonu: 11B tarar, supheli/explicit ise onay modeli (Gemma 4) dogrular, yalniz ikisi de
 * explicit derse ban. Belirsizlikte ban YOK (fail-open) ama kayit dusulur.
 */
type Karar = { explicit: boolean; reason: string };

const NOW = new Date('2026-09-25T12:00:00Z').getTime();

function gorsel(bytes = 20_000) {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array(bytes).buffer };
}

async function setup(opts: {
  users?: Record<string, unknown>[];
  checks?: Record<string, unknown>[];
  birinci?: Karar | Error;
  ikinci?: Karar | Error;
  fetchCevap?: unknown;
} = {}) {
  const fake = createFakeSupabase({
    users: opts.users ?? [{ id: 'u1', photos: ['https://x/a.jpg'], is_deleted: false, is_banned: false, is_test_account: false, created_at: '2026-09-01' }],
    photo_moderation_checks: opts.checks ?? [],
    matches: [],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const nimVisionModerate = vi.fn(async (_url: string, o?: { model?: string }) => {
    const k = o?.model === 'confirm-model' ? (opts.ikinci ?? { explicit: false, reason: 'clean' }) : (opts.birinci ?? { explicit: false, reason: 'clean' });
    if (k instanceof Error) throw k;
    return { ...k, raw: JSON.stringify(k) };
  });
  vi.doMock('../../src/services/nim.service.js', () => ({
    nimVisionModerate, NIM_VISION_MODEL: 'primary-model', NIM_VISION_CONFIRM_MODEL: 'confirm-model',
  }));
  const banUser = vi.fn(async () => true);
  vi.doMock('../../src/services/ban.service.js', () => ({ banService: { banUser } }));
  vi.stubGlobal('fetch', vi.fn(async () => opts.fetchCevap ?? gorsel()));

  const mod = await import('../../src/services/photo-moderation.service.js');
  return { mod, fake, nimVisionModerate, banUser };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('supheliGerekce', () => {
  it('ciplaklik anahtar kelimesi gecen her gerekce supheli (olumsuzlama ayiklamasi YOK), gecmeyen degil', async () => {
    const { mod } = await setup();
    expect(mod.supheliGerekce('exposed breasts of women.')).toBe(true);
    expect(mod.supheliGerekce('exposed nipples, not a sexual act')).toBe(true);
    expect(mod.supheliGerekce('no visible genitals or breasts/nipples')).toBe(true);
    expect(mod.supheliGerekce('shirtless man at the beach')).toBe(false);
    expect(mod.supheliGerekce('face only, clothed')).toBe(false);
  });
});

describe('listPendingPhotos', () => {
  it('taranmis URL atlanir, yeni URL ve eski error satiri doner; test hesabi/banli/silinmis disarida', async () => {
    const eski = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const yeni = new Date(NOW - 5 * 60 * 1000).toISOString();
    const { mod } = await setup({
      users: [
        { id: 'u1', photos: ['https://x/safe.jpg', 'https://x/new.jpg', 'https://x/err-old.jpg', 'https://x/err-new.jpg'], is_deleted: false, is_banned: false, is_test_account: false, created_at: '2026-09-01' },
        { id: 'seed', photos: ['https://x/seed.jpg'], is_deleted: false, is_banned: false, is_test_account: true, created_at: '2026-09-02' },
        { id: 'banli', photos: ['https://x/b.jpg'], is_deleted: false, is_banned: true, is_test_account: false, created_at: '2026-09-02' },
        { id: 'silik', photos: ['https://x/d.jpg'], is_deleted: true, is_banned: false, is_test_account: false, created_at: '2026-09-02' },
        { id: 'bos', photos: null, is_deleted: false, is_banned: false, is_test_account: false, created_at: '2026-09-02' },
      ],
      checks: [
        { user_id: 'u1', photo_url: 'https://x/safe.jpg', verdict: 'safe', checked_at: eski },
        { user_id: 'u1', photo_url: 'https://x/err-old.jpg', verdict: 'error', checked_at: eski },
        { user_id: 'u1', photo_url: 'https://x/err-new.jpg', verdict: 'error', checked_at: yeni },
      ],
    });
    const bekleyen = await mod.listPendingPhotos(10, NOW);
    expect(bekleyen.map((p) => p.url)).toEqual(['https://x/new.jpg', 'https://x/err-old.jpg']);
  });

  it('butce kadar doner', async () => {
    const { mod } = await setup({
      users: [{ id: 'u1', photos: ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'], is_deleted: false, is_banned: false, is_test_account: false, created_at: '2026-09-01' }],
    });
    expect(await mod.listPendingPhotos(2, NOW)).toHaveLength(2);
  });
});

describe('moderatePendingPhotos', () => {
  it('temiz fotograf: safe kaydi, dogrulama modeli cagrilmaz, ban yok', async () => {
    const { mod, fake, nimVisionModerate, banUser } = await setup({ birinci: { explicit: false, reason: 'face only' } });
    const ozet = await mod.moderatePendingPhotos(10);
    expect(ozet).toEqual({ checked: 1, banned: 0, review: 0, errors: 0 });
    expect(nimVisionModerate).toHaveBeenCalledTimes(1);
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ user_id: 'u1', photo_url: 'https://x/a.jpg', verdict: 'safe', model: 'primary-model' });
    expect(banUser).not.toHaveBeenCalled();
  });

  it('tarama explicit + onay explicit -> ban (sexual_content) ve explicit kaydi', async () => {
    const { mod, fake, banUser } = await setup({ birinci: { explicit: true, reason: 'exposed genitals' }, ikinci: { explicit: true, reason: 'nudity' } });
    const ozet = await mod.moderatePendingPhotos(10);
    expect(ozet.banned).toBe(1);
    expect(banUser).toHaveBeenCalledWith('u1', 'sexual_content', mod.BAN_REASON_TEXT);
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ verdict: 'explicit', model: 'confirm-model' });
  });

  it('tarama explicit ama onay katilmadi -> review, ban YOK', async () => {
    const { mod, fake, banUser } = await setup({ birinci: { explicit: true, reason: 'exposed nipples' }, ikinci: { explicit: false, reason: 'swimsuit' } });
    const ozet = await mod.moderatePendingPhotos(10);
    expect(ozet).toMatchObject({ review: 1, banned: 0 });
    expect(banUser).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks')[0].verdict).toBe('review');
  });

  it('11B explicit=false ama gerekce supheli -> onay sorulur; onay explicit dese de IKISI birden degil -> review, ban YOK', async () => {
    const { mod, fake, nimVisionModerate, banUser } = await setup({ birinci: { explicit: false, reason: 'exposed female breasts/nipples' }, ikinci: { explicit: true, reason: 'nudity' } });
    await mod.moderatePendingPhotos(10);
    expect(nimVisionModerate).toHaveBeenCalledTimes(2);
    expect(banUser).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ verdict: 'review', attempts: 1 });
  });

  it('error satiri MAX_ATTEMPTS denemede review\'a duser, deneme sayaci artar', async () => {
    const eski = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const { mod, fake } = await setup({
      checks: [{ user_id: 'u1', photo_url: 'https://x/a.jpg', verdict: 'error', checked_at: eski, attempts: 2 }],
      birinci: new Error('timeout'),
    });
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const ozet = await mod.moderatePendingPhotos(10);
    expect(ozet).toMatchObject({ review: 1, errors: 0 });
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ verdict: 'review', attempts: mod.MAX_ATTEMPTS });
    expect(fake.table('photo_moderation_checks')[0].reason).toMatch(/^max_attempts/);
  });

  it('kullanici zaten banliysa (baska instance) banned sayaci artmaz', async () => {
    const { mod, banUser } = await setup({ birinci: { explicit: true, reason: 'exposed genitals' }, ikinci: { explicit: true, reason: 'nudity' } });
    banUser.mockResolvedValueOnce(false as never);
    const ozet = await mod.moderatePendingPhotos(10);
    expect(banUser).toHaveBeenCalledTimes(1);
    expect(ozet.banned).toBe(0);
  });

  it('onay modeli hata verirse review (fail-open), ban YOK', async () => {
    const { mod, fake, banUser } = await setup({ birinci: { explicit: true, reason: 'exposed genitals' }, ikinci: new Error('HTTP 404') });
    await mod.moderatePendingPhotos(10);
    expect(banUser).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ verdict: 'review' });
  });

  it('11B hata verirse error kaydi (yeniden denenir), ban YOK', async () => {
    const { mod, fake, banUser } = await setup({ birinci: new Error('timeout') });
    const ozet = await mod.moderatePendingPhotos(10);
    expect(ozet.errors).toBe(1);
    expect(fake.table('photo_moderation_checks')[0].verdict).toBe('error');
    expect(banUser).not.toHaveBeenCalled();
  });

  it('cok kucuk dosya (bozuk) modele gonderilmez -> review', async () => {
    const { mod, fake, nimVisionModerate } = await setup({ fetchCevap: gorsel(514) });
    await mod.moderatePendingPhotos(10);
    expect(nimVisionModerate).not.toHaveBeenCalled();
    expect(fake.table('photo_moderation_checks')[0]).toMatchObject({ verdict: 'review', reason: 'too_small:514' });
  });

  it('indirme 500 -> error (gecici), 404 -> review (kalici)', async () => {
    const a = await setup({ fetchCevap: { ok: false, status: 500 } });
    await a.mod.moderatePendingPhotos(10);
    expect(a.fake.table('photo_moderation_checks')[0].verdict).toBe('error');
    vi.resetModules();
    const b = await setup({ fetchCevap: { ok: false, status: 404 } });
    await b.mod.moderatePendingPhotos(10);
    expect(b.fake.table('photo_moderation_checks')[0].verdict).toBe('review');
  });

  it('banlanan kullanicinin kalan fotograflari ayni tikte atlanir (tek ban)', async () => {
    const { mod, banUser, nimVisionModerate } = await setup({
      users: [{ id: 'u1', photos: ['https://x/1.jpg', 'https://x/2.jpg'], is_deleted: false, is_banned: false, is_test_account: false, created_at: '2026-09-01' }],
      birinci: { explicit: true, reason: 'exposed genitals' }, ikinci: { explicit: true, reason: 'nudity' },
    });
    const ozet = await mod.moderatePendingPhotos(10);
    expect(banUser).toHaveBeenCalledTimes(1);
    expect(ozet.checked).toBe(1);
    expect(nimVisionModerate).toHaveBeenCalledTimes(2);
  });
});
