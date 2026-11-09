import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

describe('createReportSchema — soruya bagli medya sikayeti', () => {
  const QID = '22222222-2222-4222-8222-222222222222';

  it('INAPPROPRIATE_MEDIA kategorisi + question_id gecerli', () => {
    const r = createReportSchema.safeParse({ reported_id: VALID, category: 'INAPPROPRIATE_MEDIA', question_id: QID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.question_id).toBe(QID);
  });

  it('question_id opsiyonel (eski istemci) ve mevcut kategoriyle birlikte gecerli', () => {
    expect(createReportSchema.safeParse({ reported_id: VALID, category: 'SPAM' }).success).toBe(true);
    expect(createReportSchema.safeParse({ reported_id: VALID, category: 'SPAM', question_id: QID }).success).toBe(true);
  });

  it('uuid olmayan question_id reddedilir', () => {
    expect(createReportSchema.safeParse({ reported_id: VALID, category: 'SPAM', question_id: 'x' }).success).toBe(false);
  });
});


/**
 * 2.0.19 (final review C2): prod `reports.category` Postgres enum'u `report_category`. Validator'a
 * eklenen her yeni kategori enum'a da migration ile eklenmeli; yoksa INSERT 22P02 → 500 ve
 * "uygunsuz medya" sikayeti hep basarisiz olur. 2.0.19 oncesi 10 kategori prod enum'unda zaten var.
 */
describe('report_category enum ↔ validator paritesi (migration 084)', () => {
  const PRE_2_0_19 = [
    'INAPPROPRIATE_CONTENT', 'FAKE_PROFILE', 'SPAM', 'HARASSMENT', 'UNDERAGE',
    'SCAM', 'OFFENSIVE_PHOTOS', 'THREATENING', 'IMPERSONATION', 'OTHER',
  ];
  const sql = readFileSync(new URL('../../migrations/084_question_media.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('validator\'daki her yeni kategori 084\'te enum\'a eklenir (bagimsiz, idempotent ifade)', () => {
    const added = createReportSchema.shape.category.options.filter((c) => !PRE_2_0_19.includes(c));
    expect(added).toEqual(['INAPPROPRIATE_MEDIA']);
    for (const c of added) {
      expect(code).toMatch(new RegExp(`^ALTER TYPE public\\.report_category ADD VALUE IF NOT EXISTS '${c}';$`, 'm'));
    }
  });

  it('084 transaction blogu acmaz (ADD VALUE kendi ifadesi olarak calismali)', () => {
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT|START TRANSACTION)\b/im);
  });

  it('rollback enum degerini dusurmeye calismaz, nedenini belgeler', () => {
    const rb = readFileSync(new URL('../../migrations/084_question_media_rollback.sql', import.meta.url), 'utf8');
    expect(rb).not.toMatch(/^[^-]*report_category/m);
    expect(rb).toMatch(/--.*report_category.*INAPPROPRIATE_MEDIA/);
  });
});
