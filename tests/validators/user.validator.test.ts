import { describe, it, expect } from 'vitest';
import { updateProfileSchema } from '../../src/validators/user.validator.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

// Dil tercihi: mobil 16 uygulama dilini sunuyor; validator hepsini kabul etmeli
// ("tumunu sec" ile 16 dil birden gelir).
describe('updateProfileSchema preferred_languages', () => {
  it('16 desteklenen dilin tamamini kabul eder', () => {
    const result = updateProfileSchema.safeParse({ preferred_languages: [...SUPPORTED_LOCALES] });
    expect(result.success).toBe(true);
  });

  it('tek bir dil (pt) kabul edilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: ['pt'] }).success).toBe(true);
  });

  it('desteklenmeyen dil reddedilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: ['xx'] }).success).toBe(false);
  });

  it('bos liste reddedilir', () => {
    expect(updateProfileSchema.safeParse({ preferred_languages: [] }).success).toBe(false);
  });
});
