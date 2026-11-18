import { describe, it, expect } from 'vitest';
import { whatsNewQuerySchema, whatsNewInputSchema, WHATS_NEW_LIMITS } from '../../src/validators/whats-new.validator.js';

describe('whatsNewQuerySchema', () => {
  const ok = { version: '2.2.0', platform: 'ios', locale: 'tr' };

  it('geçerli sorguyu kabul eder', () => {
    expect(whatsNewQuerySchema.parse(ok)).toEqual({ version: '2.2.0', platform: 'ios', locale: 'tr' });
  });

  it.each(['2.2', 'abc', '2.2.0.1', '', 'v2.2.0', '2.2.x', '2.2.0-beta'])('geçersiz sürüm "%s" reddedilir', (version) => {
    expect(whatsNewQuerySchema.safeParse({ ...ok, version }).success).toBe(false);
  });

  it('sürüm yoksa reddedilir', () => {
    expect(whatsNewQuerySchema.safeParse({ platform: 'ios' }).success).toBe(false);
  });

  it('+build eki atılır', () => {
    expect(whatsNewQuerySchema.parse({ ...ok, version: '2.2.0+112' }).version).toBe('2.2.0');
  });

  it('platform ios/android dışı reddedilir (all istemciden gelmez)', () => {
    expect(whatsNewQuerySchema.safeParse({ ...ok, platform: 'web' }).success).toBe(false);
    expect(whatsNewQuerySchema.safeParse({ ...ok, platform: 'all' }).success).toBe(false);
  });

  it('bilinmeyen / eksik locale en olur; tr-TR etiketi tr olur', () => {
    expect(whatsNewQuerySchema.parse({ ...ok, locale: 'xx' }).locale).toBe('en');
    expect(whatsNewQuerySchema.parse({ version: '2.2.0', platform: 'android' }).locale).toBe('en');
    expect(whatsNewQuerySchema.parse({ ...ok, locale: 'tr-TR' }).locale).toBe('tr');
  });
});

describe('whatsNewInputSchema', () => {
  const entry = { title: 'Yeni', body: 'Metin' };
  const base = { app_version: '2.2.0', platform: 'all', content: { en: entry }, image_url: null, is_active: true };

  it('en içeren geçerli girdiyi kabul eder; cta varsayılan boş', () => {
    const r = whatsNewInputSchema.parse(base);
    expect(r.content.en.cta_label).toBe('');
  });

  it('en yoksa reddeder', () => {
    expect(whatsNewInputSchema.safeParse({ ...base, content: { tr: entry } }).success).toBe(false);
  });

  it('bilinmeyen dil kodunu reddeder', () => {
    expect(whatsNewInputSchema.safeParse({ ...base, content: { en: entry, xx: entry } }).success).toBe(false);
  });

  it('http görseli reddeder, https kabul eder', () => {
    expect(whatsNewInputSchema.safeParse({ ...base, image_url: 'http://x.com/a.png' }).success).toBe(false);
    expect(whatsNewInputSchema.safeParse({ ...base, image_url: 'https://x.com/a.png' }).success).toBe(true);
  });

  it('uzunluk sınırları: başlık 60, gövde 400, düğme 24', () => {
    const L = WHATS_NEW_LIMITS;
    const gir = (e: object) => whatsNewInputSchema.safeParse({ ...base, content: { en: { ...entry, ...e } } }).success;
    expect(gir({ title: 'a'.repeat(L.title) })).toBe(true);
    expect(gir({ title: 'a'.repeat(L.title + 1) })).toBe(false);
    expect(gir({ body: 'a'.repeat(L.body) })).toBe(true);
    expect(gir({ body: 'a'.repeat(L.body + 1) })).toBe(false);
    expect(gir({ cta_label: 'a'.repeat(L.cta) })).toBe(true);
    expect(gir({ cta_label: 'a'.repeat(L.cta + 1) })).toBe(false);
  });

  it('boş başlık / metin reddedilir; sürüm biçimi ve platform denetlenir', () => {
    expect(whatsNewInputSchema.safeParse({ ...base, content: { en: { title: '', body: 'x' } } }).success).toBe(false);
    expect(whatsNewInputSchema.safeParse({ ...base, content: { en: { title: 'x', body: '' } } }).success).toBe(false);
    expect(whatsNewInputSchema.safeParse({ ...base, app_version: '2.2' }).success).toBe(false);
    expect(whatsNewInputSchema.safeParse({ ...base, platform: 'web' }).success).toBe(false);
  });
});
