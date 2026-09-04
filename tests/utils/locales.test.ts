import { describe, it, expect } from 'vitest';
import { resolveLocale, localeFromAcceptLanguage } from '../../src/utils/locales.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

describe('resolveLocale', () => {
  it('returns the same locale when supported', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(resolveLocale(loc)).toBe(loc);
    }
  });

  it('falls back to en for null', () => {
    expect(resolveLocale(null)).toBe('en');
  });

  it('falls back to en for undefined', () => {
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('falls back to en for empty string', () => {
    expect(resolveLocale('')).toBe('en');
  });

  it('falls back to en for unknown locale', () => {
    expect(resolveLocale('zz')).toBe('en');
    expect(resolveLocale('xx-YY')).toBe('en');
  });

  it('does not alter case (case-sensitive lookup)', () => {
    // SUPPORTED_LOCALES is lowercase; 'TR' should NOT match
    expect(resolveLocale('TR')).toBe('en');
  });
});

describe('localeFromAcceptLanguage', () => {
  it('strips the q-weight suffix when there is no region subtag', () => {
    expect(localeFromAcceptLanguage('de;q=0.8')).toBe('de');
  });

  it('picks the first tag among several weighted tags', () => {
    expect(localeFromAcceptLanguage('de;q=0.8,en;q=0.6')).toBe('de');
  });

  it('strips the region subtag before the q-weight', () => {
    expect(localeFromAcceptLanguage('tr-TR,tr;q=0.9')).toBe('tr');
  });

  it('lowercases both language and region subtags', () => {
    expect(localeFromAcceptLanguage('DE-de')).toBe('de');
  });

  it('falls back to en for empty, undefined or null header', () => {
    expect(localeFromAcceptLanguage('')).toBe('en');
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
    expect(localeFromAcceptLanguage(null)).toBe('en');
  });

  it('falls back to en for the wildcard tag', () => {
    expect(localeFromAcceptLanguage('*')).toBe('en');
  });

  it('falls back to en for an unsupported tag', () => {
    expect(localeFromAcceptLanguage('xx-YY')).toBe('en');
  });
});
