import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabaseOptions, type Row } from '../helpers/fake-supabase.js';
import { LlmError } from '../../src/services/llm.common.js';

/**
 * Soru gorseli moderasyonu (sesli/gorselli soru, 2.0.18+101). Merkezdeki iddialar:
 * - Onaylanmamis gorsel ASLA 'approved' olmaz: model hatasi/zaman asimi/kapali anahtar → 'pending'.
 * - Ret = gorsel kaldirilir (yol null, dosya silinir), soru metinle kalir, BAN YOK.
 * - Karar YALNIZ moderasyonu yapilan yola uygulanir (CAS): araya giren yeni gorsel onaylanmaz/ezilmez.
 * - Istem cinsel objeleri de yasaklar; baskasinin yuzu yasak DEGIL.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Q2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUCKET = 'question-media';
const P1 = `${U1}/${Q1}/image-1.jpg`;
const P2 = `${U1}/${Q2}/image-2.jpg`;

type Cevap = Record<string, unknown> | Error;

const soru = (id: string, path: string | null, status: string | null, over: Row = {}) => ({
  id, user_id: U1, order_num: 1, image_path: path, image_status: status, ...over,
});

async function setup(opts: {
  questions?: Row[];
  checks?: Row[];
  files?: string[];
  cevaplar?: Cevap[];
  enabled?: boolean;
  geminiKey?: string;
  fakeOpts?: FakeSupabaseOptions;
} = {}) {
  const fake = createFakeSupabase({
    questions: opts.questions ?? [soru(Q1, P1, 'pending')],
    photo_moderation_checks: opts.checks ?? [],
    app_config: [{ id: 'cfg', photo_moderation_enabled: opts.enabled ?? true }],
  }, { storage: { [BUCKET]: opts.files ?? [P1] }, ...opts.fakeOpts });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/config/env.js', () => ({ env: { NVIDIA_API_KEY: 'nv', GEMINI_API_KEY: opts.geminiKey ?? 'g-key' } }));

  const sira = [...(opts.cevaplar ?? [{ explicit: false, category: 'none', reason: 'a plate of food' }])];
  const geminiVisionModerate = vi.fn(async (_dataUrl: string, _o?: { timeoutMs?: number; prompt?: string }) => {
    const cevap = sira.length > 1 ? sira.shift()! : sira[0]!;
    if (cevap instanceof Error) throw cevap;
    return { explicit: Boolean(cevap.explicit), reason: String(cevap.reason ?? ''), raw: JSON.stringify(cevap) };
  });
  vi.doMock('../../src/services/gemini-vision.service.js', () => ({
    geminiVisionModerate,
    geminiVisionAvailable: () => Boolean(opts.geminiKey ?? 'g-key'),
    GEMINI_VISION_MODEL: 'gemini-model',
    GEMINI_VISION_TIMEOUT_MS: 30_000,
  }));
  const banUser = vi.fn(async () => true);
  vi.doMock('../../src/services/ban.service.js', () => ({ banService: { banUser } }));

  const mod = await import('../../src/services/question-image-moderation.service.js');
  const { QUESTION_IMAGE_PROMPT } = await import('../../src/services/nim.service.js');
  const row = (id: string) => fake.table('questions').find((r) => r.id === id)!;
  const check = (path: string) => fake.table('photo_moderation_checks').find((r) => r.photo_url === path);
  return { mod, fake, geminiVisionModerate, banUser, row, check, QUESTION_IMAGE_PROMPT };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('QUESTION_IMAGE_PROMPT', () => {
  it('cinsel obje, siddet, resit olmayan ve kisisel veri kavramlarini sayar; yuz yasak listesinde YOK', async () => {
    const { QUESTION_IMAGE_PROMPT } = await setup();
    for (const kavram of ['sex toy', 'fetish', 'condom', 'lingerie', 'minor', 'violence', 'ID card', 'license plate']) {
      expect(QUESTION_IMAGE_PROMPT).toContain(kavram);
    }
    const [yasak, izinli] = QUESTION_IMAGE_PROMPT.split('ALLOWED');
    expect(izinli).toBeDefined();
    expect(yasak).not.toMatch(/\bfaces?\b/i);
    expect(izinli).toMatch(/\bfaces?\b/i);
    // parseVisionVerdict semasiyla uyumlu: explicit + reason, ek category opsiyonel.
    expect(QUESTION_IMAGE_PROMPT).toContain('"explicit"');
    expect(QUESTION_IMAGE_PROMPT).toContain('"reason"');
    expect(QUESTION_IMAGE_PROMPT).toContain('"category"');
  });

  it('profil fotografi istemi degismedi (cinsel obje kurali profile tasinmaz)', async () => {
    await setup();
    const { VISION_MODERATION_PROMPT, QUESTION_IMAGE_PROMPT } = await import('../../src/services/nim.service.js');
    expect(VISION_MODERATION_PROMPT).not.toBe(QUESTION_IMAGE_PROMPT);
    expect(VISION_MODERATION_PROMPT).not.toContain('sex toy');
    expect(VISION_MODERATION_PROMPT).toContain('Swimwear, underwear, cleavage, or a shirtless man is NOT explicit.');
  });
});

describe('moderateQuestionImage', () => {
  it('cinsel obje → rejected: yol null, dosya silinir, check review/question; BAN YOK', async () => {
    const { mod, fake, row, check, banUser, geminiVisionModerate, QUESTION_IMAGE_PROMPT } = await setup({
      cevaplar: [{ explicit: true, category: 'sexual_object', reason: 'a sex toy on a bed' }],
    });

    expect(await mod.moderateQuestionImage(Q1)).toBe('rejected');

    expect(row(Q1)).toMatchObject({ image_path: null, image_status: 'rejected' });
    expect(fake.storageFiles(BUCKET)).not.toContain(P1);
    expect(check(P1)).toMatchObject({ kind: 'question', user_id: U1, verdict: 'review', attempts: 1, model: 'gemini-model' });
    expect(check(P1)!.reason).toContain('sexual_object');
    expect(banUser).not.toHaveBeenCalled();
    // Private bucket: baytlar service-role indirmeyle, JPEG data URL olarak; soru istemi + 8 sn.
    const [dataUrl, o] = geminiVisionModerate.mock.calls[0]!;
    expect(dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from(`fake-file:${P1}`).toString('base64')}`);
    expect(o).toEqual({ prompt: QUESTION_IMAGE_PROMPT, timeoutMs: mod.QUESTION_IMAGE_TIMEOUT_MS });
    expect(mod.QUESTION_IMAGE_TIMEOUT_MS).toBe(8000);
  });

  it('temiz yanit → approved; dosya ve yol yerinde, check safe', async () => {
    const { mod, fake, row, check } = await setup();
    expect(await mod.moderateQuestionImage(Q1)).toBe('approved');
    expect(row(Q1)).toMatchObject({ image_path: P1, image_status: 'approved' });
    expect(fake.storageFiles(BUCKET)).toContain(P1);
    expect(check(P1)).toMatchObject({ kind: 'question', verdict: 'safe', attempts: 1 });
  });

  it('masum benzer nesne (salatada salatalik) → approved', async () => {
    const { mod, row } = await setup({ cevaplar: [{ explicit: false, reason: 'cucumber in salad' }] });
    expect(await mod.moderateQuestionImage(Q1)).toBe('approved');
    expect(row(Q1).image_status).toBe('approved');
  });

  it('explicit=false ama yasak kategori ya da celiskili gerekce → rejected (belirsizlik onaylanmaz)', async () => {
    const a = await setup({ cevaplar: [{ explicit: false, category: 'personal_data', reason: 'a passport page' }] });
    expect(await a.mod.moderateQuestionImage(Q1)).toBe('rejected');
    vi.resetModules();
    const b = await setup({ cevaplar: [{ explicit: false, reason: 'exposed nipples' }] });
    expect(await b.mod.moderateQuestionImage(Q1)).toBe('rejected');
    expect(b.banUser).not.toHaveBeenCalled();
  });

  it('category "none" + temiz gerekce → approved', async () => {
    const { mod, row } = await setup({ cevaplar: [{ explicit: false, category: 'none', reason: 'a cat on a sofa' }] });
    expect(await mod.moderateQuestionImage(Q1)).toBe('approved');
    expect(row(Q1).image_status).toBe('approved');
  });

  it('bilinmeyen category (explicit=false) → ONAYLANMAZ: pending + check review (insan karar verir), dosya kalir', async () => {
    const a = await setup({ cevaplar: [{ explicit: false, category: 'weapon', reason: 'a knife' }] });
    expect(await a.mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(a.row(Q1)).toMatchObject({ image_path: P1, image_status: 'pending' });
    expect(a.check(P1)).toMatchObject({ kind: 'question', verdict: 'review', attempts: 1 });
    expect(a.check(P1)!.reason).toContain('weapon');
    expect(a.fake.storageFiles(BUCKET)).toContain(P1);
    // Insan kuyrugundaki gorsel cron'da modele yeniden sorulmaz.
    expect(await a.mod.moderatePendingQuestionImages(25)).toBe(0);
    expect(a.geminiVisionModerate).toHaveBeenCalledTimes(1);
    expect(a.banUser).not.toHaveBeenCalled();
  });

  it('yasak kategorinin yazim varyanti ("sexual object", "Sexual-Object") → rejected', async () => {
    for (const category of ['sexual object', 'Sexual-Object']) {
      vi.resetModules();
      const { mod, row } = await setup({ cevaplar: [{ explicit: false, category, reason: 'an item' }] });
      expect(await mod.moderateQuestionImage(Q1)).toBe('rejected');
      expect(row(Q1)).toMatchObject({ image_path: null, image_status: 'rejected' });
    }
  });

  it('zaman asimi → pending (check error), sonra cron isler ve onaylar', async () => {
    const { mod, row, check, geminiVisionModerate } = await setup({
      cevaplar: [new LlmError('timeout', 'Gemini istegi zaman asimina ugradi'), { explicit: false, category: 'none', reason: 'a dog' }],
    });

    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: P1, image_status: 'pending' });
    expect(check(P1)).toMatchObject({ verdict: 'error', attempts: 1 });

    expect(await mod.moderatePendingQuestionImages(25)).toBe(1);
    expect(row(Q1).image_status).toBe('approved');
    expect(check(P1)).toMatchObject({ verdict: 'safe', attempts: 2 });
    // Asenkron yol bekleyebilir: cron uzun zaman asimiyla sorar.
    expect(geminiVisionModerate.mock.calls[1]![1]).toMatchObject({ timeoutMs: 30_000 });
  });

  it('cozulemeyen model cevabi / indirme hatasi → pending, asla approved', async () => {
    const { mod, row } = await setup({ cevaplar: [new LlmError('empty', 'Gemini gorsel moderasyon cevabi cozulemedi')] });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1).image_status).toBe('pending');

    vi.resetModules();
    const b = await setup({ fakeOpts: { storageFailOn: [{ bucket: BUCKET, op: 'download' }] } });
    expect(await b.mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(b.geminiVisionModerate).not.toHaveBeenCalled();
    expect(b.check(P1)).toMatchObject({ verdict: 'error', attempts: 1 });
  });

  it('moderasyon kapali ya da Gemini anahtari yok → pending, model cagrilmaz, kayit yok (fail-closed)', async () => {
    const a = await setup({ enabled: false });
    expect(await a.mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(a.geminiVisionModerate).not.toHaveBeenCalled();
    expect(a.row(Q1).image_status).toBe('pending');
    expect(a.fake.table('photo_moderation_checks')).toEqual([]);

    vi.resetModules();
    const b = await setup({ geminiKey: '' });
    expect(await b.mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(b.geminiVisionModerate).not.toHaveBeenCalled();
    expect(b.row(Q1).image_status).toBe('pending');
  });

  it('3. hatadan sonra review: gorsel pending kalir (gizli), insan karar verir; cron artik denemez', async () => {
    const { mod, row, check, geminiVisionModerate } = await setup({
      checks: [{ id: 'c1', user_id: U1, photo_url: P1, kind: 'question', verdict: 'error', attempts: 2, checked_at: '2026-11-09T00:00:00Z' }],
      cevaplar: [new Error('gemini down')],
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(check(P1)).toMatchObject({ verdict: 'review', attempts: 3 });
    expect(check(P1)!.reason).toContain('max_attempts');
    expect(row(Q1).image_status).toBe('pending');

    expect(await mod.moderatePendingQuestionImages(25)).toBe(0);
    expect(geminiVisionModerate).toHaveBeenCalledTimes(1);
  });

  it('karar sirasinda gorsel degisti → yeni gorsel ONAYLANMAZ', async () => {
    const PYENI = `${U1}/${Q1}/image-9.jpg`;
    const { mod, row } = await setup({
      files: [P1, PYENI],
      fakeOpts: { interleave: [{ table: 'questions', mutate: (rows) => { rows[0]!.image_path = PYENI; } }] },
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: PYENI, image_status: 'pending' });
  });

  it('karar sirasinda gorsel degisti → ret yeni gorseli EZMEZ; CAS kaybinda dosya/kayit dokunulmaz (eskiyi writeSlot siler)', async () => {
    const PYENI = `${U1}/${Q1}/image-9.jpg`;
    const { mod, fake, row, check, banUser } = await setup({
      files: [P1, PYENI],
      cevaplar: [{ explicit: true, category: 'sexual_content', reason: 'nudity' }],
      fakeOpts: { interleave: [{ table: 'questions', mutate: (rows) => { rows[0]!.image_path = PYENI; } }] },
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: PYENI, image_status: 'pending' });
    expect(fake.storageFiles(BUCKET)).toEqual([P1, PYENI]);
    expect(check(P1)).toBeUndefined();
    expect(banUser).not.toHaveBeenCalled();
  });

  it('yaris: admin "safe" onayladi, cron ret karari CAS kaybeder → dosya KALIR, admin kaydi ezilmez', async () => {
    const adminKaydi = { id: 'c1', user_id: U1, photo_url: P1, kind: 'question', verdict: 'safe', model: 'admin', attempts: 3, checked_at: '2026-11-09T09:00:00Z' };
    const { mod, fake, row, check } = await setup({
      checks: [{ ...adminKaydi, verdict: 'error', model: 'gemini-model', attempts: 1 }],
      cevaplar: [{ explicit: true, category: 'sexual_object', reason: 'model false positive' }],
      fakeOpts: { interleave: [{ table: 'questions', mutate: (rows) => {
        rows[0]!.image_status = 'approved';
        const c = fake.table('photo_moderation_checks')[0]!;
        Object.assign(c, adminKaydi);
      } }] },
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: P1, image_status: 'approved' });
    expect(fake.storageFiles(BUCKET)).toContain(P1);
    expect(check(P1)).toMatchObject(adminKaydi);
  });

  it('yaris: admin "gorseli kaldir" dedi, cron onay karari CAS kaybeder → onaylanmaz, admin kaydi ezilmez', async () => {
    const adminKaydi = { id: 'c1', user_id: U1, photo_url: P1, kind: 'question', verdict: 'explicit', model: 'admin', attempts: 1, checked_at: '2026-11-09T09:00:00Z' };
    const { mod, fake, row, check } = await setup({
      checks: [{ ...adminKaydi, verdict: 'error', model: 'gemini-model' }],
      fakeOpts: { interleave: [{ table: 'questions', mutate: (rows) => {
        Object.assign(rows[0]!, { image_path: null, image_status: 'rejected' });
        Object.assign(fake.table('photo_moderation_checks')[0]!, adminKaydi);
      } }] },
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: null, image_status: 'rejected' });
    expect(check(P1)).toMatchObject(adminKaydi);
  });

  it('soru satiri guncellenemezse → pending; dosya silinmez (satir hala onu gosteriyor)', async () => {
    const { mod, fake, row } = await setup({
      cevaplar: [{ explicit: true, category: 'sexual_object', reason: 'condom' }],
      fakeOpts: { failOn: [{ table: 'questions', op: 'update' }] },
    });
    expect(await mod.moderateQuestionImage(Q1)).toBe('pending');
    expect(row(Q1)).toMatchObject({ image_path: P1, image_status: 'pending' });
    expect(fake.storageFiles(BUCKET)).toContain(P1);
  });

  it('yukleme yolu baytlari verirse depolamadan indirilmez (egress yok)', async () => {
    const { mod, geminiVisionModerate } = await setup({ fakeOpts: { storageFailOn: [{ bucket: BUCKET, op: 'download' }] } });
    const bytes = Buffer.from('yeni-jpeg');
    expect(await mod.moderateQuestionImage(Q1, { image: { path: P1, bytes } })).toBe('approved');
    expect(geminiVisionModerate.mock.calls[0]![0]).toBe(`data:image/jpeg;base64,${bytes.toString('base64')}`);
  });

  it('baytlar baska yola aitse (araya yeni yukleme girdi) kullanilmaz; guncel yol indirilir', async () => {
    const PYENI = `${U1}/${Q1}/image-9.jpg`;
    const { mod, geminiVisionModerate } = await setup({ questions: [soru(Q1, PYENI, 'pending')], files: [PYENI] });
    expect(await mod.moderateQuestionImage(Q1, { image: { path: P1, bytes: Buffer.from('eski') } })).toBe('approved');
    expect(geminiVisionModerate.mock.calls[0]![0]).toBe(`data:image/jpeg;base64,${Buffer.from(`fake-file:${PYENI}`).toString('base64')}`);
  });

  it('zaten karar verilmis gorsel yeniden sorulmaz', async () => {
    const { mod, geminiVisionModerate } = await setup({ questions: [soru(Q1, P1, 'approved')] });
    expect(await mod.moderateQuestionImage(Q1)).toBe('approved');
    expect(geminiVisionModerate).not.toHaveBeenCalled();
  });
});

describe('moderatePendingQuestionImages', () => {
  it('yalniz pending + karar bekleyen (kayitsiz / error) gorselleri butce kadar isler; ban yok', async () => {
    const Q3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const Q4 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const P3 = `${U1}/${Q3}/image-3.jpg`;
    const P4 = `${U1}/${Q4}/image-4.jpg`;
    const { mod, row, geminiVisionModerate, banUser } = await setup({
      questions: [
        soru(Q1, P1, 'pending'),
        soru(Q2, P2, 'approved'),
        soru(Q3, P3, 'pending'),
        soru(Q4, P4, 'pending'),
        soru('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, 'rejected'),
      ],
      files: [P1, P2, P3, P4],
      checks: [{ id: 'c4', user_id: U1, photo_url: P4, kind: 'question', verdict: 'review', attempts: 3, checked_at: '2026-11-09T00:00:00Z' }],
      cevaplar: [{ explicit: true, category: 'sexual_object', reason: 'fetish gear' }],
    });

    expect(await mod.moderatePendingQuestionImages(1)).toBe(1);
    expect(geminiVisionModerate).toHaveBeenCalledTimes(1);

    expect(await mod.moderatePendingQuestionImages(25)).toBe(1);
    expect(row(Q1).image_status).toBe('rejected');
    expect(row(Q3).image_status).toBe('rejected');
    expect(row(Q2).image_status).toBe('approved');
    expect(row(Q4).image_status).toBe('pending'); // insan kuyrugunda
    expect(banUser).not.toHaveBeenCalled();
  });

  it('kapaliyken hic sorgu/model cagrisi yok', async () => {
    const { mod, geminiVisionModerate } = await setup({ enabled: false });
    expect(await mod.moderatePendingQuestionImages(25)).toBe(0);
    expect(geminiVisionModerate).not.toHaveBeenCalled();
  });
});

describe('resolveQuestionImageCheck (backoffice)', () => {
  const C = '22222222-2222-4222-8222-222222222222';
  const satir = (over: Row = {}) => ({ id: C, user_id: U1, photo_url: P1, kind: 'question', verdict: 'review', attempts: 3, checked_at: '2026-11-09T00:00:00Z', ...over });

  it('safe → bekleyen gorsel approved, check safe/admin; ban yok', async () => {
    const { mod, row, check, banUser } = await setup({ checks: [satir()] });
    expect(await mod.resolveQuestionImageCheck(C, 'safe')).toBe(true);
    expect(row(Q1).image_status).toBe('approved');
    expect(check(P1)).toMatchObject({ verdict: 'safe', model: 'admin' });
    expect(banUser).not.toHaveBeenCalled();
  });

  it('remove_image → yol null, rejected, dosya silinir, check explicit/admin; ban yok', async () => {
    const { mod, fake, row, check, banUser } = await setup({ checks: [satir()] });
    expect(await mod.resolveQuestionImageCheck(C, 'remove_image')).toBe(true);
    expect(row(Q1)).toMatchObject({ image_path: null, image_status: 'rejected' });
    expect(fake.storageFiles(BUCKET)).not.toContain(P1);
    expect(check(P1)).toMatchObject({ verdict: 'explicit', model: 'admin' });
    expect(banUser).not.toHaveBeenCalled();
  });

  it('safe, artik soruda olmayan (degistirilmis) yolu onaylamaz', async () => {
    const PYENI = `${U1}/${Q1}/image-9.jpg`;
    const { mod, row } = await setup({ questions: [soru(Q1, PYENI, 'pending')], files: [PYENI], checks: [satir()] });
    expect(await mod.resolveQuestionImageCheck(C, 'safe')).toBe(true);
    expect(row(Q1)).toMatchObject({ image_path: PYENI, image_status: 'pending' });
  });

  it('profil satiri ya da bilinmeyen id → false, hicbir sey degismez', async () => {
    const { mod, row } = await setup({ checks: [satir({ kind: 'profile' })] });
    expect(await mod.resolveQuestionImageCheck(C, 'remove_image')).toBe(false);
    expect(await mod.resolveQuestionImageCheck('44444444-4444-4444-8444-444444444444', 'safe')).toBe(false);
    expect(row(Q1)).toMatchObject({ image_path: P1, image_status: 'pending' });
  });
});
