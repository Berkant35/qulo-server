import { describe, it, expect } from 'vitest';
import { resolveLocale } from '../../src/utils/locales.js';
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
