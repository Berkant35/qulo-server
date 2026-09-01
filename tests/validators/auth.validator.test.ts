import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
} from '../../src/validators/auth.validator.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

/** Şemayı geçen taban girdi — testler tek alanı bozarak ilerler. */
const validRegister = {
  email: 'a@qulo.test',
  password: 'Sifre1234!',
  name: 'Ada',
  surname: 'Lovelace',
  age: 28,
  gender: 'WOMAN',
  locale: 'tr',
  tos_accepted: true,
};

const parse = (over: Record<string, unknown> = {}) =>
  registerSchema.safeParse({ ...validRegister, ...over });

describe('registerSchema — locale', () => {
  /**
   * Regresyon koruması: mobil `Localizations.localeOf(context).languageCode`
   * gönderiyor, yani 16 dilden herhangi biri gelebiliyor. Şema bir dönem
   * tr/en'de kalmıştı ve Almanca/Fransızca cihazlar 400 alıp hiç kayıt olamıyordu.
   */
  it('desteklenen 16 dilin hepsini kabul eder', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(parse({ locale }).success, locale).toBe(true);
    }
  });

  it('desteklenmeyen dili reddeder', () => {
    expect(parse({ locale: 'xx' }).success).toBe(false);
    expect(parse({ locale: 'tr-TR' }).success).toBe(false);
  });

  it('locale verilmezse tr varsayılır', () => {
    const { locale, ...withoutLocale } = validRegister;
    const result = registerSchema.safeParse(withoutLocale);
    expect(result.success && result.data.locale).toBe('tr');
  });
});

describe('registerSchema — zorunlu alanlar', () => {
  it('geçerli girdi kabul edilir', () => {
    expect(parse().success).toBe(true);
  });

  it('geçersiz e-posta reddedilir', () => {
    for (const email of ['dosya', 'a@', '@b.com', '']) {
      expect(parse({ email }).success, email).toBe(false);
    }
  });

  it('8 karakterden kısa şifre reddedilir', () => {
    expect(parse({ password: 'kisa12' }).success).toBe(false);
    expect(parse({ password: '12345678' }).success).toBe(true);
  });

  it('boş ad/soyad reddedilir (sadece boşluk dahil)', () => {
    expect(parse({ name: '' }).success).toBe(false);
    expect(parse({ name: '   ' }).success).toBe(false);
    expect(parse({ surname: '' }).success).toBe(false);
  });

  it('ad/soyad kırpılır', () => {
    const result = parse({ name: '  Ada  ' });
    expect(result.success && result.data.name).toBe('Ada');
  });

  // 18 yaş sınırı yasal zorunluluk — flört uygulaması.
  it('18 yaş altı reddedilir', () => {
    expect(parse({ age: 17 }).success).toBe(false);
    expect(parse({ age: 18 }).success).toBe(true);
  });

  it('gerçekçi olmayan yaş reddedilir', () => {
    expect(parse({ age: 100 }).success).toBe(false);
    expect(parse({ age: 99 }).success).toBe(true);
  });

  it('ondalıklı yaş reddedilir', () => {
    expect(parse({ age: 25.5 }).success).toBe(false);
  });

  it('geçersiz cinsiyet reddedilir', () => {
    expect(parse({ gender: 'female' }).success).toBe(false);
    expect(parse({ gender: 'MAN' }).success).toBe(true);
    expect(parse({ gender: 'OTHER' }).success).toBe(true);
  });

  it('gender_pref opsiyonel ama geçersiz değeri reddedilir', () => {
    const { ...withoutPref } = validRegister;
    expect(registerSchema.safeParse(withoutPref).success).toBe(true);
    expect(parse({ gender_pref: 'BOTH' }).success).toBe(true);
    expect(parse({ gender_pref: 'ANY' }).success).toBe(false);
  });

  /** Yasal onay — sessizce atlanamamalı. */
  it('kullanım koşulları onayı zorunlu', () => {
    const { tos_accepted, ...withoutTos } = validRegister;
    expect(registerSchema.safeParse(withoutTos).success).toBe(false);
    expect(parse({ tos_accepted: false }).success).toBe(false);
  });
});

describe('registerSchema — konum ve davet kodu', () => {
  it('geçerli koordinat kabul edilir', () => {
    expect(parse({ lat: 41.0, lng: 29.0 }).success).toBe(true);
  });

  it('aralık dışı koordinat reddedilir', () => {
    expect(parse({ lat: 91 }).success).toBe(false);
    expect(parse({ lat: -91 }).success).toBe(false);
    expect(parse({ lng: 181 }).success).toBe(false);
    expect(parse({ lng: -181 }).success).toBe(false);
  });

  it('sınır koordinatları kabul edilir', () => {
    expect(parse({ lat: 90, lng: 180 }).success).toBe(true);
    expect(parse({ lat: -90, lng: -180 }).success).toBe(true);
  });

  it('davet kodu opsiyonel, uzunluk sınırlı', () => {
    expect(parse({ referral_code: 'AAAA2222' }).success).toBe(true);
    expect(parse({ referral_code: '' }).success).toBe(false);
    expect(parse({ referral_code: 'A'.repeat(11) }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('geçerli girdi kabul edilir', () => {
    expect(loginSchema.safeParse({ email: 'a@qulo.test', password: 'Sifre1234!' }).success).toBe(true);
  });

  it('geçersiz e-posta reddedilir', () => {
    expect(loginSchema.safeParse({ email: 'dosya', password: 'Sifre1234!' }).success).toBe(false);
  });

  it('eksik şifre reddedilir', () => {
    expect(loginSchema.safeParse({ email: 'a@qulo.test' }).success).toBe(false);
  });

  /**
   * Giriş de kayıtla aynı min-8 kuralını uyguluyor. Yan etki: 8 karakterden kısa
   * şifreyle açılmış eski bir hesap varsa giriş yapamaz (böyle hesap üretilemediği
   * için pratikte sorun değil). Kural değişirse test kırılsın diye sabitleniyor.
   */
  it('8 karakterden kısa şifre girişte de reddedilir', () => {
    expect(loginSchema.safeParse({ email: 'a@qulo.test', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@qulo.test', password: '12345678' }).success).toBe(true);
  });
});
