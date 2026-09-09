import { describe, it, expect } from 'vitest';
import { createReportSchema } from '../../src/validators/report.validator.js';

/**
 * Sikayet semasi — moderasyon yolu, App Store/Play gereksinimi.
 *
 * `reason` ZORUNLUYDU ve istemci bunu bilmiyordu: her iki sikayet ekrani da
 * `reason.isNotEmpty ? reason : null` gonderiyor
 * (chat_moderation_mixin.dart:130, profile_detail_screen_mixin.dart:200), yani
 * sebep yazmayan kullanicinin sikayeti 400 aliyordu. Cagri yerleri sonucu
 * kontrol etmedigi icin kullanici hata bile gormuyordu — sessiz kayip.
 */
const VALID = '11111111-1111-4111-8111-111111111111';

describe('createReportSchema', () => {
  it('sebep YAZILMADAN sikayet gecerlidir', () => {
    // Asil duzeltme: kategori zaten sikayetin ozunu tasiyor.
    const result = createReportSchema.safeParse({
      reported_id: VALID,
      category: 'HARASSMENT',
    });

    expect(result.success).toBe(true);
  });

  it('sebep yazilirsa tasinir', () => {
    const result = createReportSchema.safeParse({
      reported_id: VALID,
      category: 'SPAM',
      reason: 'Surekli reklam mesaji atiyor',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.reason).toBe('Surekli reklam mesaji atiyor');
  });

  it('KISA sebep de kabul edilir — min(5) kaldirildi', () => {
    // Ilk duzeltmede min(5) birakilmisti; review "ayni bug'in daralmis hali"
    // dedi ve haklıydi: chat sikayet dialog'unda minimum uzunluk kontrolu YOK
    // (chat_moderation_mixin.dart:110-114), yani "spam" yazan kullanici 400
    // alir ve yine sessizce kaybolurdu.
    const result = createReportSchema.safeParse({
      reported_id: VALID, category: 'SPAM', reason: 'spam',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.reason).toBe('spam');
  });

  it('SADECE BOSLUKTAN ibaret sebep undefined olur, 400 degil', () => {
    // Once `"   "` API'den dogrudan gelirse 400 aliyordu.
    const result = createReportSchema.safeParse({
      reported_id: VALID, category: 'SPAM', reason: '   ',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.reason).toBeUndefined();
  });

  it('sebep bastan/sondan kirpilir', () => {
    const result = createReportSchema.safeParse({
      reported_id: VALID, category: 'SPAM', reason: '  reklam atiyor  ',
    });

    expect(result.success && result.data.reason).toBe('reklam atiyor');
  });

  it('cok uzun sebep reddedilir', () => {
    expect(createReportSchema.safeParse({
      reported_id: VALID, category: 'SPAM', reason: 'a'.repeat(1001),
    }).success).toBe(false);
  });

  it('kategori ZORUNLU — sikayetin ozunu o tasiyor', () => {
    expect(createReportSchema.safeParse({ reported_id: VALID }).success).toBe(false);
  });

  it('on kategorinin hepsi kabul edilir', () => {
    for (const category of [
      'INAPPROPRIATE_CONTENT', 'FAKE_PROFILE', 'SPAM', 'HARASSMENT', 'UNDERAGE',
      'SCAM', 'OFFENSIVE_PHOTOS', 'THREATENING', 'IMPERSONATION', 'OTHER',
    ]) {
      expect(
        createReportSchema.safeParse({ reported_id: VALID, category }).success,
        `${category} kabul edilmeli`,
      ).toBe(true);
    }
  });

  it('bilinmeyen kategori reddedilir', () => {
    expect(createReportSchema.safeParse({
      reported_id: VALID, category: 'SOMETHING_ELSE',
    }).success).toBe(false);
  });

  it('gecersiz uuid reddedilir', () => {
    expect(createReportSchema.safeParse({
      reported_id: 'not-a-uuid', category: 'SPAM',
    }).success).toBe(false);
  });
});
