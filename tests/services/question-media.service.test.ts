import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeSupabase, fakeSignedUrl, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Soru medyasi (sesli/gorselli soru, 2.0.19) — yukleme / degistirme / silme.
 *
 * Merkezdeki iddialar:
 * - Yol YALNIZ sunucu kimliklerinden: `${userId}/${questionId}/${kind}-${ts}.(m4a|jpg)`; soru
 *   `user_id + order_num` ile bulunur, baskasinin sorusuna yazilamaz.
 * - Tur / boyut / sure sunucuda dogrulanir; beyan edilen tur icerikle tutmazsa red.
 * - Degistirmede eski dosya YALNIZ yeni satir yazildiktan sonra silinir; DB yazimi patlarsa
 *   yeni dosya geri alinir (sahipsiz dosya yok), depolama patlarsa DB'ye isaretci yazilmaz.
 * - Bucket private: URL'ler 600 sn imzali.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const QA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUCKET = 'question-media';
const NOW = 1_762_700_000_000;

/** MP4/M4A kabı: 4. bayttan itibaren `ftyp` kutusu. */
const M4A = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(64, 1)]);
/** ADTS AAC: 0xFFF senkron sözcüğü. */
const ADTS = () => Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(64, 2)]);
const PNG = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a6' } }).png().toBuffer();

const q = (id: string, userId: string, orderNum: number, over: Record<string, unknown> = {}) => ({
  id, user_id: userId, order_num: orderNum, question_text: `Soru ${orderNum}`,
  voice_path: null, voice_duration_ms: null, image_path: null, image_status: null, ...over,
});

async function setup(seed: Tables = {}, opts?: FakeSupabaseOptions, karar: 'pending' | 'approved' | 'rejected' = 'pending') {
  const fake = createFakeSupabase({ questions: [q(QA, A, 1), q(QB, B, 1)], ...seed }, opts);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  // Senkron gorsel moderasyonu ayri test dosyasinda; burada yalniz cagri sozlesmesi ve yanit sinanir.
  const satirOnModerasyon: Array<Record<string, unknown>> = [];
  const moderateQuestionImage = vi.fn(async (questionId: string) => {
    satirOnModerasyon.push({ ...fake.table('questions').find((r) => r.id === questionId) });
    return karar;
  });
  vi.doMock('../../src/services/question-image-moderation.service.js', () => ({ moderateQuestionImage }));
  const { questionMediaService } = await import('../../src/services/question-media.service.js');
  const row = (id: string) => fake.table('questions').find((r) => r.id === id)!;
  return { fake, questionMediaService, row, moderateQuestionImage, satirOnModerasyon };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (err) { return (err as { code?: string }).code; }
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadVoice', () => {
  it('yolu sunucu kimliklerinden kurar, satiri yazar; yanit = guncel soru (GET /me ogesi sekli, ham yol yok)', async () => {
    const { fake, questionMediaService, row } = await setup();

    const media = await questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 4200);

    const path = `${A}/${QA}/voice-${NOW}.m4a`;
    expect(fake.storageFiles(BUCKET)).toEqual([path]);
    expect(fake.storageUploads[0].opts).toMatchObject({ contentType: 'audio/m4a', upsert: false });
    expect(row(QA)).toMatchObject({ voice_path: path, voice_duration_ms: 4200 });
    expect(media).toEqual({
      id: QA, user_id: A, order_num: 1, question_text: 'Soru 1',
      voice_url: fakeSignedUrl(BUCKET, path, 600),
      voice_duration_ms: 4200,
      image_url: null,
      image_status: null,
    });
    expect(media).not.toHaveProperty('voice_path');
    expect(media).not.toHaveProperty('image_path');
  });

  it('yanit, GET /questions/me (getMyQuestions) ogesiyle birebir ayni', async () => {
    const { questionMediaService } = await setup();
    const media = await questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 4200);
    const { questionService } = await import('../../src/services/question.service.js');
    const [mine] = await questionService.getMyQuestions(A);
    expect(media).toEqual(mine);
  });

  it('ADTS AAC (audio/aac) da kabul edilir', async () => {
    const { questionMediaService, row } = await setup();
    await questionMediaService.uploadVoice(A, 1, ADTS(), 'audio/aac', 1000);
    expect(row(QA).voice_path).toBe(`${A}/${QA}/voice-${NOW}.m4a`);
  });

  it.each([[15_001], [0], [-5], [1.5], [Number.NaN]])('sure %s ms → 400 VALIDATION_ERROR, hicbir sey yazilmaz', async (ms) => {
    const { fake, questionMediaService, row } = await setup();

    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', ms))).toBe('VALIDATION_ERROR');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
    expect(row(QA).voice_path).toBeNull();
  });

  it('sinirdaki 15 000 ms kabul edilir', async () => {
    const { questionMediaService, row } = await setup();
    await questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 15_000);
    expect(row(QA).voice_duration_ms).toBe(15_000);
  });

  it('audio/mpeg → 400 INVALID_FILE_TYPE', async () => {
    const { fake, questionMediaService } = await setup();
    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/mpeg', 3000))).toBe('INVALID_FILE_TYPE');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });

  it('beyan audio/m4a ama icerik ses kabi degil (HTML) → 400 INVALID_FILE_TYPE', async () => {
    const { fake, questionMediaService } = await setup();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(await codeOf(questionMediaService.uploadVoice(A, 1, html, 'audio/m4a', 3000))).toBe('INVALID_FILE_TYPE');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });

  it('1 MB ustu → 413 PAYLOAD_TOO_LARGE', async () => {
    const { fake, questionMediaService } = await setup();
    const big = Buffer.concat([M4A(), Buffer.alloc(1024 * 1024)]);
    expect(await codeOf(questionMediaService.uploadVoice(A, 1, big, 'audio/m4a', 3000))).toBe('PAYLOAD_TOO_LARGE');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });

  it('BASKASININ sorusuna yuklenemez: yalniz user_id + order_num eslesmesi', async () => {
    // B'nin 2. sorusu var, A'nin yok — A order 2'ye yuklemeye calisir.
    const { fake, questionMediaService, row } = await setup({
      questions: [q(QA, A, 1), q(QB, B, 2)],
    });

    expect(await codeOf(questionMediaService.uploadVoice(A, 2, M4A(), 'audio/m4a', 3000))).toBe('QUESTION_NOT_FOUND');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
    expect(row(QB).voice_path).toBeNull();
  });

  it('degistirmede eski dosya yeni satir yazildiktan SONRA silinir', async () => {
    const old = `${A}/${QA}/voice-1.m4a`;
    const { fake, questionMediaService, row } = await setup(
      { questions: [q(QA, A, 1, { voice_path: old, voice_duration_ms: 2000 })] },
      { storage: { [BUCKET]: [old] } },
    );

    await questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 5000);

    const fresh = `${A}/${QA}/voice-${NOW}.m4a`;
    expect(row(QA)).toMatchObject({ voice_path: fresh, voice_duration_ms: 5000 });
    expect(fake.storageFiles(BUCKET)).toEqual([fresh]);
  });

  it('DB yazimi patlarsa yeni dosya geri alinir, eski dosya ve satir yerinde kalir', async () => {
    const old = `${A}/${QA}/voice-1.m4a`;
    const { fake, questionMediaService, row } = await setup(
      { questions: [q(QA, A, 1, { voice_path: old, voice_duration_ms: 2000 })] },
      { storage: { [BUCKET]: [old] }, failOn: [{ table: 'questions', op: 'update' }] },
    );

    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 5000))).toBe('SERVER_ERROR');
    expect(fake.storageFiles(BUCKET)).toEqual([old]);
    expect(row(QA)).toMatchObject({ voice_path: old, voice_duration_ms: 2000 });
  });

  it('depolama yazimi patlarsa satira isaretci yazilmaz', async () => {
    const { questionMediaService, row } = await setup({}, { storageFailOn: [{ bucket: BUCKET, op: 'upload' }] });

    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 3000))).toBe('SERVER_ERROR');
    expect(row(QA).voice_path).toBeNull();
  });

  it('eszamanli degistirme (okuma ile yazma arasinda yol degisti) → 409, yeni dosya geri alinir', async () => {
    const other = `${A}/${QA}/voice-777.m4a`;
    const { fake, questionMediaService, row } = await setup({}, {
      storage: { [BUCKET]: [other] },
      interleave: [{ table: 'questions', op: 'update', mutate: (rows) => { rows.find((r) => r.id === QA)!.voice_path = other; } }],
    });

    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 3000))).toBe('QUESTION_MEDIA_CONFLICT');
    expect(row(QA).voice_path).toBe(other);
    expect(fake.storageFiles(BUCKET)).toEqual([other]);
  });

  it('soru okuma ile yazma arasinda silindiyse yeni dosya geri alinir', async () => {
    const { fake, questionMediaService } = await setup({}, {
      interleave: [{ table: 'questions', op: 'update', mutate: (rows) => { rows.splice(rows.findIndex((r) => r.id === QA), 1); } }],
    });

    expect(await codeOf(questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 3000))).toBe('QUESTION_MEDIA_CONFLICT');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });
});

describe('uploadImage', () => {
  it('JPEG\'e cevirir, image_status=pending yazar; sahip kendi pending gorselinin URL\'ini alir', async () => {
    const { fake, questionMediaService, row } = await setup();

    const media = await questionMediaService.uploadImage(A, 1, await PNG(), 'image/png');

    const path = `${A}/${QA}/image-${NOW}.jpg`;
    expect(fake.storageFiles(BUCKET)).toEqual([path]);
    const yazilan = fake.storageUploads[0];
    expect(yazilan.opts).toMatchObject({ contentType: 'image/jpeg', upsert: false });
    expect((await sharp(yazilan.body as Buffer).metadata()).format).toBe('jpeg');
    expect(row(QA)).toMatchObject({ image_path: path, image_status: 'pending' });
    expect(media).toEqual({
      id: QA, user_id: A, order_num: 1, question_text: 'Soru 1',
      voice_url: null, voice_duration_ms: null,
      image_url: fakeSignedUrl(BUCKET, path, 600), image_status: 'pending',
    });
  });

  it('satir pending yazildiktan SONRA senkron moderasyon cagrilir; ses yuklemesinde cagrilmaz', async () => {
    const { fake, questionMediaService, moderateQuestionImage, satirOnModerasyon } = await setup();
    await questionMediaService.uploadImage(A, 1, await PNG(), 'image/png');
    // Az once yazilan JPEG baytlari yoluyla birlikte gider: moderasyon depolamadan geri indirmez (egress yok).
    expect(moderateQuestionImage).toHaveBeenCalledWith(QA, {
      image: { path: `${A}/${QA}/image-${NOW}.jpg`, bytes: fake.storageUploads[0]!.body },
    });
    expect(satirOnModerasyon[0]).toMatchObject({ image_path: `${A}/${QA}/image-${NOW}.jpg`, image_status: 'pending' });
    await questionMediaService.uploadVoice(A, 1, M4A(), 'audio/m4a', 3000);
    expect(moderateQuestionImage).toHaveBeenCalledTimes(1);
  });

  it('moderasyon reddederse yanitta URL yok, image_status=rejected', async () => {
    const { questionMediaService } = await setup({}, undefined, 'rejected');
    const media = await questionMediaService.uploadImage(A, 1, await PNG(), 'image/png');
    expect(media).toMatchObject({ id: QA, order_num: 1, image_url: null, image_status: 'rejected' });
    expect(media).not.toHaveProperty('image_path');
  });

  it('moderasyon onaylarsa yanit approved + imzali URL', async () => {
    const { questionMediaService } = await setup({}, undefined, 'approved');
    const media = await questionMediaService.uploadImage(A, 1, await PNG(), 'image/png');
    expect(media).toMatchObject({ image_url: fakeSignedUrl(BUCKET, `${A}/${QA}/image-${NOW}.jpg`, 600), image_status: 'approved' });
  });

  it('onayli gorsel degistirilince yenisi pending olur, eski dosya silinir', async () => {
    const old = `${A}/${QA}/image-1.jpg`;
    const { fake, questionMediaService, row } = await setup(
      { questions: [q(QA, A, 1, { image_path: old, image_status: 'approved' })] },
      { storage: { [BUCKET]: [old] } },
    );

    await questionMediaService.uploadImage(A, 1, await PNG(), 'image/png');

    expect(row(QA)).toMatchObject({ image_path: `${A}/${QA}/image-${NOW}.jpg`, image_status: 'pending' });
    expect(fake.storageFiles(BUCKET)).not.toContain(old);
  });

  it('image/gif → 400 INVALID_FILE_TYPE; cozulemeyen icerik de', async () => {
    const { fake, questionMediaService } = await setup();
    expect(await codeOf(questionMediaService.uploadImage(A, 1, await PNG(), 'image/gif'))).toBe('INVALID_FILE_TYPE');
    expect(await codeOf(questionMediaService.uploadImage(A, 1, Buffer.from('not an image'), 'image/png'))).toBe('INVALID_FILE_TYPE');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });

  it('8 MB ustu → 413 PAYLOAD_TOO_LARGE', async () => {
    const { questionMediaService } = await setup();
    const big = Buffer.alloc(8 * 1024 * 1024 + 1);
    expect(await codeOf(questionMediaService.uploadImage(A, 1, big, 'image/jpeg'))).toBe('PAYLOAD_TOO_LARGE');
  });

  it('BASKASININ sorusuna gorsel yuklenemez', async () => {
    const { fake, questionMediaService } = await setup({ questions: [q(QB, B, 1)] });
    expect(await codeOf(questionMediaService.uploadImage(A, 1, await PNG(), 'image/png'))).toBe('QUESTION_NOT_FOUND');
    expect(fake.storageFiles(BUCKET)).toEqual([]);
  });
});

describe('removeMedia', () => {
  const voice = `${A}/${QA}/voice-1.m4a`;
  const image = `${A}/${QA}/image-2.jpg`;
  const withBoth = () => ({ questions: [q(QA, A, 1, { voice_path: voice, voice_duration_ms: 3000, image_path: image, image_status: 'approved' }), q(QB, B, 1)] });

  it('ses: satir alanlari bosalir, dosya silinir, gorsel dokunulmaz', async () => {
    const { fake, questionMediaService, row } = await setup(withBoth(), { storage: { [BUCKET]: [voice, image] } });

    await questionMediaService.removeMedia(A, 1, 'voice');

    expect(row(QA)).toMatchObject({ voice_path: null, voice_duration_ms: null, image_path: image, image_status: 'approved' });
    expect(fake.storageFiles(BUCKET)).toEqual([image]);
  });

  it('gorsel: yol ve durum bosalir, dosya silinir', async () => {
    const { fake, questionMediaService, row } = await setup(withBoth(), { storage: { [BUCKET]: [voice, image] } });

    await questionMediaService.removeMedia(A, 1, 'image');

    expect(row(QA)).toMatchObject({ image_path: null, image_status: null, voice_path: voice });
    expect(fake.storageFiles(BUCKET)).toEqual([voice]);
  });

  it('reddedilen gorsel (yol yok, durum rejected) kaldirilinca ret notu temizlenir', async () => {
    const { questionMediaService, row } = await setup({ questions: [q(QA, A, 1, { image_status: 'rejected' })] });

    await questionMediaService.removeMedia(A, 1, 'image');

    expect(row(QA)).toMatchObject({ image_path: null, image_status: null });
  });

  it('sesi kaldirmak ret notuna dokunmaz', async () => {
    const { questionMediaService, row } = await setup({ questions: [q(QA, A, 1, { image_status: 'rejected' })] });
    await questionMediaService.removeMedia(A, 1, 'voice');
    expect(row(QA).image_status).toBe('rejected');
  });

  it('ret notu temizligi CAS: okuma ile yazma arasinda yeni gorsel yuklendiyse ona dokunmaz', async () => {
    const fresh = `${A}/${QA}/image-9.jpg`;
    const { questionMediaService, row } = await setup({ questions: [q(QA, A, 1, { image_status: 'rejected' })] }, {
      interleave: [{ table: 'questions', op: 'update', mutate: (rows) => {
        Object.assign(rows.find((r) => r.id === QA)!, { image_path: fresh, image_status: 'pending' });
      } }],
    });

    await expect(questionMediaService.removeMedia(A, 1, 'image')).resolves.toBeUndefined();
    expect(row(QA)).toMatchObject({ image_path: fresh, image_status: 'pending' });
  });

  it('ret notu temizlenemezse (DB hatasi) SERVER_ERROR', async () => {
    const { questionMediaService } = await setup({ questions: [q(QA, A, 1, { image_status: 'rejected' })] }, {
      failOn: [{ table: 'questions', op: 'update' }],
    });
    expect(await codeOf(questionMediaService.removeMedia(A, 1, 'image'))).toBe('SERVER_ERROR');
  });

  it('medyasi olmayan soruda sorunsuz (idempotent)', async () => {
    const { questionMediaService } = await setup();
    await expect(questionMediaService.removeMedia(A, 1, 'voice')).resolves.toBeUndefined();
  });

  it('BASKASININ sorusunun medyasi silinemez', async () => {
    const otherVoice = `${B}/${QB}/voice-1.m4a`;
    const { fake, questionMediaService, row } = await setup(
      { questions: [q(QB, B, 1, { voice_path: otherVoice, voice_duration_ms: 1000 })] },
      { storage: { [BUCKET]: [otherVoice] } },
    );

    expect(await codeOf(questionMediaService.removeMedia(A, 1, 'voice'))).toBe('QUESTION_NOT_FOUND');
    expect(row(QB).voice_path).toBe(otherVoice);
    expect(fake.storageFiles(BUCKET)).toEqual([otherVoice]);
  });

  it('DB yazimi patlarsa dosya silinmez (isaretci dosyasiz kalmaz)', async () => {
    const { fake, questionMediaService, row } = await setup(withBoth(), {
      storage: { [BUCKET]: [voice, image] },
      failOn: [{ table: 'questions', op: 'update' }],
    });

    expect(await codeOf(questionMediaService.removeMedia(A, 1, 'voice'))).toBe('SERVER_ERROR');
    expect(row(QA).voice_path).toBe(voice);
    expect(fake.storageFiles(BUCKET)).toEqual([voice, image]);
  });
});

describe('signedUrl / removeAllForQuestion', () => {
  it('null yol → null; var olan yol → 600 sn imzali URL', async () => {
    const path = `${A}/${QA}/image-1.jpg`;
    const { questionMediaService } = await setup({}, { storage: { [BUCKET]: [path] } });

    expect(await questionMediaService.signedUrl(null)).toBeNull();
    expect(await questionMediaService.signedUrl(path)).toBe(fakeSignedUrl(BUCKET, path, 600));
  });

  it('imzalama hatasi → null (yanit patlamaz)', async () => {
    const path = `${A}/${QA}/image-1.jpg`;
    const { questionMediaService } = await setup({}, {
      storage: { [BUCKET]: [path] },
      storageFailOn: [{ bucket: BUCKET, op: 'sign' }],
    });
    expect(await questionMediaService.signedUrl(path)).toBeNull();
  });

  it('removeAllForQuestion iki dosyayi da siler, baskasininkine dokunmaz', async () => {
    const voice = `${A}/${QA}/voice-1.m4a`;
    const image = `${A}/${QA}/image-2.jpg`;
    const keep = `${B}/${QB}/image-3.jpg`;
    const { fake, questionMediaService } = await setup({}, { storage: { [BUCKET]: [voice, image, keep] } });

    await questionMediaService.removeAllForQuestion({ voice_path: voice, image_path: image });
    await questionMediaService.removeAllForQuestion({ voice_path: null, image_path: null });

    expect(fake.storageFiles(BUCKET)).toEqual([keep]);
  });
});
