import { describe, it, expect } from 'vitest';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';
import { serverLocales, localeText } from '../../src/utils/server-locales.js';

/**
 * Paylasilan sunucu metin yukleyicisi. Dosyalar arasi anahtar/bos metin/yer
 * tutucu paritesi `src/__tests__/locale-parity.test.ts`'te (burada tekrarlanmaz).
 */
describe('serverLocales', () => {
  it('desteklenen her dilin dosyasi yuklu', () => {
    expect(Object.keys(serverLocales).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
});

describe('localeText', () => {
  it('istenen dilin metnini doner', () => {
    expect(localeText('de', 'chat_preview', 'voice')).toBe('Sprachnachricht');
  });

  it('eski istemcinin (tr) onizlemesi degismedi — birebir eski metin', () => {
    expect(`🎤 ${localeText('tr', 'chat_preview', 'voice')}`).toBe('🎤 Sesli mesaj');
    expect(`📷 ${localeText('tr', 'chat_preview', 'photo')}`).toBe('📷 Fotoğraf');
  });

  it('dilde metin yoksa en metnine duser', () => {
    const section = serverLocales.de.chat_preview;
    const original = section.voice;
    delete section.voice;
    try {
      expect(localeText('de', 'chat_preview', 'voice')).toBe('Voice message');
    } finally {
      section.voice = original;
    }
  });

  it('bilinmeyen anahtar bos string — istisna atmaz', () => {
    expect(localeText('en', 'chat_preview', 'yok')).toBe('');
    expect(localeText('en', 'yok', 'voice')).toBe('');
  });
});
