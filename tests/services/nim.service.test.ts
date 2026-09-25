import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sohbet = (content: string | null) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 50, completion_tokens: 27 },
  }),
});

async function yukle(anahtar = 'nv-test-key') {
  vi.doMock('../../src/config/env.js', () => ({ env: { NVIDIA_API_KEY: anahtar } }));
  return import('../../src/services/nim.service.js');
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('nimChat', () => {
  it('OpenAI uyumlu istegi Bearer anahtar ve system/assistant rolleriyle kurar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sohbet('  selam ya  '));
    vi.stubGlobal('fetch', fetchMock);
    const { nimChat, NIM_BASE_URL, NIM_CHAT_MODEL } = await yukle();

    const r = await nimChat({
      system: 'Sen Elif\'sin.',
      turns: [{ role: 'user', text: 'nbr' }, { role: 'model', text: 'iyiyim' }, { role: 'user', text: 'sen?' }],
      temperature: 0.7,
      maxTokens: 80,
    });

    expect(r).toEqual({ text: 'selam ya', inputTokens: 50, outputTokens: 27 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${NIM_BASE_URL}/chat/completions`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer nv-test-key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(NIM_CHAT_MODEL);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(80);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Sen Elif\'sin.' },
      { role: 'user', content: 'nbr' },
      { role: 'assistant', content: 'iyiyim' },
      { role: 'user', content: 'sen?' },
    ]);
  });

  it('system verilmezse system mesaji eklemez ve model parametresi one gecer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sohbet('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const { nimChat } = await yukle();
    await nimChat({ model: 'z-ai/glm-5.3-flash', turns: [{ role: 'user', text: 'x' }] });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe('z-ai/glm-5.3-flash');
    expect(body.messages).toEqual([{ role: 'user', content: 'x' }]);
  });

  it('anahtar yoksa no_key hatasi verir ve ag cagrisi yapmaz', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { nimChat, nimEmbed, nimContentSafety } = await yukle('');
    await expect(nimChat({ turns: [] })).rejects.toMatchObject({ code: 'no_key' });
    await expect(nimEmbed(['a'])).rejects.toMatchObject({ code: 'no_key' });
    await expect(nimContentSafety('a')).rejects.toMatchObject({ code: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP 429 -> http', { ok: false, status: 429, text: async () => 'rate limited' }, 'http', '429'],
    ['abort -> timeout', Object.assign(new Error('aborted'), { name: 'TimeoutError' }), 'timeout', 'zaman asimi'],
    ['bozuk JSON -> empty', { ok: true, json: async () => { throw new SyntaxError('bad'); } }, 'empty', 'JSON'],
    // Reasoning modelleri content=null + reasoning_content dondurebiliyor — bos sayilir.
    ['content null -> empty', sohbet(null), 'empty', 'bos'],
    ['choices bos -> empty', { ok: true, json: async () => ({ choices: [] }) }, 'empty', 'bos'],
  ])('%s', async (_ad, fetchSonucu, code, mesajParcasi) => {
    const fetchMock = fetchSonucu instanceof Error
      ? vi.fn().mockRejectedValue(fetchSonucu)
      : vi.fn().mockResolvedValue(fetchSonucu);
    vi.stubGlobal('fetch', fetchMock);
    const { nimChat } = await yukle();
    await expect(nimChat({ turns: [], timeoutMs: 5 })).rejects.toMatchObject({ code, message: expect.stringContaining(mesajParcasi) });
  });

  it('HTTP hata govdesindeki anahtari maskeler, satir sonlarini duzler ve 200 karakterde kirpar', async () => {
    const govde = 'Invalid key nvapi-VR0Gkx_abc\nAIzaSyD-xyz ' + 'x'.repeat(300);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => govde }));
    const { nimChat } = await yukle();
    const hata: Error = await nimChat({ turns: [] }).then(() => { throw new Error('beklenen hata gelmedi'); }, (e: Error) => e);
    expect(hata.message).toContain('NIM HTTP 401: Invalid key [redacted] [redacted] x');
    expect(hata.message).not.toMatch(/nvapi-|AIza/);
    expect(hata.message).not.toContain('\n');
    expect(hata.message.length).toBeLessThanOrEqual('NIM HTTP 401: '.length + 200);
  });

  it('usage yoksa token sayilari 0 doner ve timeoutMs abort sinyaline gider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const { nimChat } = await yukle();
    const r = await nimChat({ turns: [], timeoutMs: 1234 });
    expect(r).toEqual({ text: 'ok', inputTokens: 0, outputTokens: 0 });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('SeedLlmError ile ayni sinif: seed-reply cagiranlari instanceof ile ayirt edebilir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'x' }));
    const { nimChat } = await yukle();
    const { SeedLlmError } = await import('../../src/services/seed-llm.service.js');
    await expect(nimChat({ turns: [] })).rejects.toBeInstanceOf(SeedLlmError);
  });
});

describe('nimContentSafety', () => {
  it.each([
    ['unsafe', 'User Safety: unsafe\nSafety Categories: Sexual, PII/Privacy', false],
    ['safe', 'User Safety: safe', true],
    ['JSON sarmali', '{"User Safety": "unsafe", "Safety Categories": "PII/Privacy"}', false],
  ])('"%s" cevabini cozer', async (_ad, raw, safe) => {
    const fetchMock = vi.fn().mockResolvedValue(sohbet(raw));
    vi.stubGlobal('fetch', fetchMock);
    const { nimContentSafety, NIM_SAFETY_MODEL } = await yukle();
    const r = await nimContentSafety('instagramımı ver');
    expect(r.safe).toBe(safe);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe(NIM_SAFETY_MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'instagramımı ver' }]);
  });

  it('beklenmeyen cevabi guvenli SAYMAZ, empty hatasi verir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sohbet('Bu mesaj gayet safe bence')));
    const { nimContentSafety } = await yukle();
    await expect(nimContentSafety('x')).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('nimEmbed', () => {
  it('girdi sirasina gore vektorleri doner, bos girdi icin ag cagrisi yapmaz', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 0, embedding: [0.1, 0.2] }, { index: 1, embedding: [0.3, 0.4] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { nimEmbed, NIM_EMBED_MODEL } = await yukle();

    expect(await nimEmbed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    const v = await nimEmbed(['kahve mi çay mı?', 'deniz mi dağ mı?'], { inputType: 'query' });
    expect(v).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ model: NIM_EMBED_MODEL, input: ['kahve mi çay mı?', 'deniz mi dağ mı?'], input_type: 'query' });
  });

  it('ters gelen index sirasini girdi sirasina cevirir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ index: 1, embedding: [0.9] }, { index: 0, embedding: [0.1] }] }),
    }));
    const { nimEmbed } = await yukle();
    expect(await nimEmbed(['ilk', 'ikinci'])).toEqual([[0.1], [0.9]]);
  });

  it.each([
    ['vektor sayisi eksik', [{ embedding: [0.1] }]],
    ['bos vektor', [{ embedding: [0.1] }, { embedding: [] }]],
  ])('%s -> empty hatasi', async (_ad, data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }));
    const { nimEmbed } = await yukle();
    await expect(nimEmbed(['a', 'b'])).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('nimVisionModerate', () => {
  it('gorseli image_url parcasi olarak, temperature 0 ile vision modeline gonderir ve JSON kararini cozer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sohbet('{"explicit": true, "reason": "exposed genitals"}'));
    vi.stubGlobal('fetch', fetchMock);
    const { nimVisionModerate, NIM_VISION_MODEL, VISION_MODERATION_PROMPT } = await yukle();

    const r = await nimVisionModerate('data:image/jpeg;base64,AAAA');
    expect(r).toMatchObject({ explicit: true, reason: 'exposed genitals' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe(NIM_VISION_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: VISION_MODERATION_PROMPT },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
  });

  it('model parametresi one gecer (dogrulama modeli) ve false karari cozulur', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sohbet('Sure! {"explicit": false, "reason": "swimsuit"}.'));
    vi.stubGlobal('fetch', fetchMock);
    const { nimVisionModerate, NIM_VISION_CONFIRM_MODEL } = await yukle();
    const r = await nimVisionModerate('data:image/png;base64,BBBB', { model: NIM_VISION_CONFIRM_MODEL });
    expect(r).toMatchObject({ explicit: false, reason: 'swimsuit' });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe(NIM_VISION_CONFIRM_MODEL);
  });

  it('JSON karari yoksa empty hatasi — belirsizlik guvenli SAYILMAZ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sohbet('I cannot classify this image.')));
    const { nimVisionModerate } = await yukle();
    await expect(nimVisionModerate('data:image/jpeg;base64,AAAA')).rejects.toMatchObject({ code: 'empty' });
  });

  it('anahtar yoksa no_key', async () => {
    const { nimVisionModerate } = await yukle('');
    await expect(nimVisionModerate('data:image/jpeg;base64,AAAA')).rejects.toMatchObject({ code: 'no_key' });
  });
});
