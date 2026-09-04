import { describe, it, expect } from 'vitest';
import { resolveLocale, localeFromTag, localeFromRequestHeaders } from '../../src/utils/locales.js';
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

describe('localeFromTag', () => {
  it('strips the q-weight suffix when there is no region subtag', () => {
    expect(localeFromTag('de;q=0.8')).toBe('de');
  });

  it('picks the first tag among several weighted tags', () => {
    expect(localeFromTag('de;q=0.8,en;q=0.6')).toBe('de');
  });

  it('strips the region subtag before the q-weight', () => {
    expect(localeFromTag('tr-TR,tr;q=0.9')).toBe('tr');
  });

  it('lowercases both language and region subtags', () => {
    expect(localeFromTag('DE-de')).toBe('de');
  });

  it('falls back to en for empty, undefined or null header', () => {
    expect(localeFromTag('')).toBe('en');
    expect(localeFromTag(undefined)).toBe('en');
    expect(localeFromTag(null)).toBe('en');
  });

  it('falls back to en for the wildcard tag', () => {
    expect(localeFromTag('*')).toBe('en');
  });

  it('falls back to en for an unsupported tag', () => {
    expect(localeFromTag('xx-YY')).toBe('en');
  });

  it('splits on underscore as well as hyphen', () => {
    expect(localeFromTag('tr_TR')).toBe('tr');
  });

  it('handles a hyphenated region tag with no q-weight', () => {
    expect(localeFromTag('en-US')).toBe('en');
  });

  it('skips an entry whose q-value is 0 and tries the next one', () => {
    expect(localeFromTag('en;q=0,de')).toBe('de');
  });

  it('skips an unsupported entry and tries the next one', () => {
    expect(localeFromTag('xx,de')).toBe('de');
  });

  it('falls back to en when the only entry is unsupported', () => {
    expect(localeFromTag('xx')).toBe('en');
  });

  it('trims whitespace around comma-separated entries', () => {
    expect(localeFromTag(' de , en ')).toBe('de');
  });
});

describe('localeFromRequestHeaders', () => {
  it('falls back to the legacy client locale (tr) when the header is absent', () => {
    expect(localeFromRequestHeaders({})).toBe('tr');
  });

  it('parses the header when present', () => {
    expect(localeFromRequestHeaders({ 'accept-language': 'de' })).toBe('de');
  });

  it('an empty-string header counts as present and parses to en', () => {
    expect(localeFromRequestHeaders({ 'accept-language': '' })).toBe('en');
  });

  it('falls back to en for an unsupported header value', () => {
    expect(localeFromRequestHeaders({ 'accept-language': 'xx' })).toBe('en');
  });
});
