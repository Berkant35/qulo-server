import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Fotograf moderasyonu onay modeli: Gemini Flash-Lite, inlineData gorsel, ayni JSON semasi. */
const cevap = (text: string | null) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

async function yukle(anahtar = 'AIza-test') {
  vi.doMock('../../src/config/env.js', () => ({ env: { GEMINI_API_KEY: anahtar, NVIDIA_API_KEY: 'nv' } }));
  return import('../../src/services/gemini-vision.service.js');
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('geminiVisionModerate', () => {
  it('data URL\'yi inlineData parcasina cevirir, verify istemi + temperature 0 + BLOCK_NONE ile gonderir, JSON kararini cozer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(cevap('{"explicit": true, "reason": "exposed male genitalia"}'));
    vi.stubGlobal('fetch', fetchMock);
    const { geminiVisionModerate, GEMINI_VISION_MODEL } = await yukle();
    const { VISION_VERIFY_PROMPT } = await import('../../src/services/nim.service.js');

    const r = await geminiVisionModerate('data:image/jpeg;base64,AAAA');
    expect(r).toMatchObject({ explicit: true, reason: 'exposed male genitalia' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain(`/models/${GEMINI_VISION_MODEL}:generateContent`);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test');
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts).toEqual([
      { text: VISION_VERIFY_PROMPT },
      { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } },
    ]);
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.safetySettings).toContainEqual({ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' });
  });

  it('false karari ve metin etrafindaki gurultu cozulur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cevap('```json\n{"explicit": false, "reason": "cleavage only"}\n```')));
    const { geminiVisionModerate } = await yukle();
    expect(await geminiVisionModerate('data:image/png;base64,BBBB')).toMatchObject({ explicit: false, reason: 'cleavage only' });
  });

  it('JSON karari yoksa empty — belirsizlik guvenli SAYILMAZ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cevap('I cannot help with that.')));
    const { geminiVisionModerate } = await yukle();
    await expect(geminiVisionModerate('data:image/jpeg;base64,AAAA')).rejects.toMatchObject({ code: 'empty' });
  });

  it('gecersiz data URL -> empty, ag cagrisi yok', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { geminiVisionModerate } = await yukle();
    await expect(geminiVisionModerate('https://x/a.jpg')).rejects.toMatchObject({ code: 'empty' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('anahtar yoksa no_key ve geminiVisionAvailable false', async () => {
    const { geminiVisionModerate, geminiVisionAvailable } = await yukle('');
    expect(geminiVisionAvailable()).toBe(false);
    await expect(geminiVisionModerate('data:image/jpeg;base64,AAAA')).rejects.toMatchObject({ code: 'no_key' });
  });
});
