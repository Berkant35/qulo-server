import { describe, it, expect } from 'vitest';
import {
  monthStartUtc,
  accountAgeDays,
  suggestedRainbowPrice,
  maskDeliveryCode,
} from '../../src/utils/rewards.js';

describe('monthStartUtc', () => {
  it('UTC takvim ayının ilk anı', () => {
    expect(monthStartUtc(new Date('2026-09-27T23:59:00Z'))).toBe('2026-09-01T00:00:00.000Z');
  });

  it('yerel saatle yeni ay başlasa da UTC ayı esas (sunucu saat diliminden bağımsız)', () => {
    expect(monthStartUtc(new Date('2026-10-01T00:30:00+03:00'))).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('accountAgeDays', () => {
  it('gün farkı (kesirli)', () => {
    expect(accountAgeDays('2026-09-01T00:00:00Z', new Date('2026-10-01T00:00:00Z'))).toBe(30);
    expect(accountAgeDays('2026-09-01T00:00:00Z', new Date('2026-09-01T12:00:00Z'))).toBe(0.5);
  });
});

describe('suggestedRainbowPrice', () => {
  it.each([
    [0.6, 20],
    [1.42, 48],
    [1.23, 41],
    [1.51, 51],
    [2.46, 82],
    [3.03, 101],
    [0.64, 22],
  ])('başlangıç kataloğu (067) ile aynı: %s $ → %s rainbow', (cost, expected) => {
    expect(suggestedRainbowPrice(cost, 0.03)).toBe(expected);
  });

  it('kayan nokta artığı fiyatı bir birim şişirmez (0,9 / 0,03 = 30, 31 değil)', () => {
    expect(suggestedRainbowPrice(0.9, 0.03)).toBe(30);
  });

  it('maliyet yoksa öneri yok', () => {
    expect(suggestedRainbowPrice(null, 0.03)).toBeNull();
    expect(suggestedRainbowPrice(undefined, 0.03)).toBeNull();
    expect(suggestedRainbowPrice(0, 0.03)).toBeNull();
  });

  it('çok ucuz ürün en az 1 rainbow', () => {
    expect(suggestedRainbowPrice(0.001, 0.07)).toBe(1);
  });
});

describe('maskDeliveryCode', () => {
  it.each([
    [null, ''],
    ['', ''],
    ['ABCD', '••••'],
    ['ABCDEFGHI', '••••'],
    ['ABCDEFGHIJKL', '••••IJKL'],
  ])('%s → %s (kısa kodun son 4 hanesi kodun çoğunu açardı)', (code, masked) => {
    expect(maskDeliveryCode(code)).toBe(masked);
  });
});
