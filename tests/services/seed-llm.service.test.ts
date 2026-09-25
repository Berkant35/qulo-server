import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const cevap = (text: string) => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 },
  }),
});

async function yukle() {
  vi.doMock('../../src/config/env.js', () => ({ env: { GEMINI_API_KEY: 'test-key' } }));
  return import('../../src/services/seed-llm.service.js');
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('generateSeedReply', () => {
  it('istegi dogru model, thinkingLevel ve guvenlik ayarlariyla kurar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cevap('valla iyiyim ya'));
    vi.stubGlobal('fetch', fetchMock);
    const { generateSeedReply, SEED_LLM_MODEL } = await yukle();

    const r = await generateSeedReply({ system: 'Sen Elif\'sin.', turns: [{ role: 'user', text: 'nbr' }] });

    expect(r.text).toBe('valla iyiyim ya');
    expect(r.inputTokens).toBe(120);
    expect(r.outputTokens).toBe(30);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(SEED_LLM_MODEL);
    expect(SEED_LLM_MODEL).toBe('gemini-3.5-flash-lite');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
    expect(body.safetySettings).toHaveLength(4);
    expect(body.safetySettings.every((s: { threshold: string }) => s.threshold === 'BLOCK_NONE')).toBe(true);
    expect(body.safetySettings.map((s: { category: string }) => s.category)).toEqual([
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ]);
    expect(body.systemInstruction.parts[0].text).toBe('Sen Elif\'sin.');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'nbr' }] }]);
  });

  it('anahtar yoksa no_key hatasi verir ve ag cagrisi yapmaz', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock('../../src/config/env.js', () => ({ env: { GEMINI_API_KEY: '' } }));
    const { generateSeedReply, SeedLlmError } = await import('../../src/services/seed-llm.service.js');

    await expect(generateSeedReply({ system: 's', turns: [] })).rejects.toBeInstanceOf(SeedLlmError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP hatasini http koduyla sarar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' }));
    const { generateSeedReply } = await yukle();
    await expect(generateSeedReply({ system: 's', turns: [] })).rejects.toMatchObject({ code: 'http' });
  });

  it('bos cevabi empty koduyla reddeder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cevap('   ')));
    const { generateSeedReply } = await yukle();
    await expect(generateSeedReply({ system: 's', turns: [] })).rejects.toMatchObject({ code: 'empty' });
  });

  it('abort sinyalini timeout koduna cevirir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    const { generateSeedReply } = await yukle();
    await expect(generateSeedReply({ system: 's', turns: [], timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('bozuk JSON cevabini empty koduyla reddeder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('bad json'); },
    }));
    const { generateSeedReply } = await yukle();
    await expect(generateSeedReply({ system: 's', turns: [] })).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('generateSeedReply — SEED_LLM_PROVIDER=nvidia', () => {
  async function nvidiaYukle(anahtar = 'nv-key') {
    vi.doMock('../../src/config/env.js', () => ({
      env: { GEMINI_API_KEY: '', NVIDIA_API_KEY: anahtar, SEED_LLM_PROVIDER: 'nvidia' },
    }));
    return import('../../src/services/seed-llm.service.js');
  }

  it('istegi NIM ucuna OpenAI semasiyla gonderir, Gemini anahtari gerekmez', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'valla iyiyim ya' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { generateSeedReply, SEED_LLM_MODEL, SEED_LLM_PROVIDER } = await nvidiaYukle();

    const r = await generateSeedReply({ system: 'Sen Elif\'sin.', turns: [{ role: 'user', text: 'nbr' }, { role: 'model', text: 'iyi' }] });

    expect(SEED_LLM_PROVIDER).toBe('nvidia');
    expect(SEED_LLM_MODEL).toBe('google/gemma-4-31b-it');
    expect(r).toEqual({ text: 'valla iyiyim ya', inputTokens: 5, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer nv-key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(SEED_LLM_MODEL);
    expect(body.temperature).toBe(1.0);
    expect(body.max_tokens).toBe(2000);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Sen Elif\'sin.' },
      { role: 'user', content: 'nbr' },
      { role: 'assistant', content: 'iyi' },
    ]);
  });

  it('NIM anahtari yoksa no_key hatasi SeedLlmError olarak gelir', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { generateSeedReply, SeedLlmError } = await nvidiaYukle('');
    const hata = await generateSeedReply({ system: 's', turns: [] }).catch((e) => e);
    expect(hata).toBeInstanceOf(SeedLlmError);
    expect(hata.code).toBe('no_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
