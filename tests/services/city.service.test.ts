import { describe, it, expect } from 'vitest';
import { CITIES } from '../../src/data/cities.js';
import { cityService, foldForSearch } from '../../src/services/city.service.js';

describe('data/cities — statik liste butunlugu', () => {
  it('Turkiye 81 il merkezi; toplam 15 ulke', () => {
    expect(CITIES.filter((c) => c.country === 'TR')).toHaveLength(81);
    expect(cityService.countries()).toHaveLength(15);
    expect(cityService.countries()[0]).toBe('TR');
  });

  it('id\'ler benzersiz ve "<ULKE>-<slug>" bicimde (istemci id\'yi geri yollar)', () => {
    const ids = CITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CITIES) expect(c.id).toMatch(new RegExp(`^${c.country}-[a-z0-9-]{1,60}$`));
  });

  it('koordinatlar gecerli aralikta ve ulke kabaca dogru yarim kurede', () => {
    for (const c of CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lng)).toBeLessThanOrEqual(180);
      if (c.country === 'TR') {
        expect(c.lat).toBeGreaterThan(35.8); expect(c.lat).toBeLessThan(42.2);
        expect(c.lng).toBeGreaterThan(25.6); expect(c.lng).toBeLessThan(44.9);
      }
      if (['US', 'MX', 'DO', 'BR'].includes(c.country)) expect(c.lng).toBeLessThan(0);
      if (c.country === 'BR') expect(c.lat).toBeLessThan(0);
    }
  });
});

describe('cityService.search', () => {
  it('Turkce katlama: "istanbul", "ISTANBUL", "ıstanbul" hepsi İstanbul\'u bulur', () => {
    for (const q of ['istanbul', 'ISTANBUL', 'ıstanbul', 'İst']) {
      expect(cityService.search({ country: 'TR', q })[0]?.id).toBe('TR-istanbul');
    }
    expect(foldForSearch('Şanlıurfa')).toBe('sanliurfa');
  });

  it('aksansiz arama aksanli adi bulur; takma ad (Antep, Rome, 東京) da bulur', () => {
    expect(cityService.search({ q: 'sao paulo' })[0]?.id).toBe('BR-sao-paulo');
    expect(cityService.search({ country: 'TR', q: 'antep' })[0]?.id).toBe('TR-gaziantep');
    expect(cityService.search({ q: 'rome' })[0]?.id).toBe('IT-roma');
    expect(cityService.search({ q: '東京' })[0]?.id).toBe('JP-tokyo');
  });

  it('basta uyan once, icinde gecen sonra', () => {
    const res = cityService.search({ country: 'TR', q: 'kar' }).map((c) => c.id);
    expect(res.slice(0, 3)).toEqual(['TR-kars', 'TR-karaman', 'TR-karabuk']);
    expect(res).toContain('TR-afyonkarahisar');
    expect(res.indexOf('TR-afyonkarahisar')).toBeGreaterThan(res.indexOf('TR-karabuk'));
  });

  it('ulke filtresi + limit; aramasiz liste listedeki sirayla (TR plaka sirasi)', () => {
    expect(cityService.search({ country: 'TR' })[0]?.name).toBe('Adana');
    expect(cityService.search({ country: 'TR' })).toHaveLength(81);
    expect(cityService.search({ country: 'TR', limit: 5 })).toHaveLength(5);
    expect(cityService.search({ country: 'IT', q: 'istanbul' })).toEqual([]);
    expect(cityService.search({ country: 'ZZ' })).toEqual([]);
  });

  it('yanit koordinat ve takma ad sizdirmaz: yalniz id/name/country', () => {
    for (const c of cityService.search({ q: 'a', limit: 100 })) expect(Object.keys(c).sort()).toEqual(['country', 'id', 'name']);
  });

  it('findById koordinati dondurur; bilinmeyen id null', () => {
    expect(cityService.findById('TR-ankara')).toMatchObject({ lat: 39.9334, lng: 32.8597 });
    expect(cityService.findById('TR-nope')).toBeNull();
  });
});

describe('activitySignal saat yuvarlamasi (polling ile donus anini cikarma)', () => {
  it('kova saat basina yuvarlanmis gorulme zamanindan hesaplanir', async () => {
    const { activitySignal } = await import('../../src/utils/activity-signal.js');
    const now = Date.parse('2026-11-09T12:20:00Z');
    // Ham fark 23 sa 30 dk ("today" olurdu); 12:00'a yuvarlaninca 24 sa 20 dk → "week".
    expect(activitySignal('2026-11-08T12:50:00Z', now)).toBe('week');
    expect(activitySignal('2026-11-08T13:05:00Z', now)).toBe('today');
    expect(activitySignal('2026-11-02T13:05:00Z', now)).toBe('week');
    expect(activitySignal('2026-11-01T12:00:00Z', now)).toBeNull();
    expect(activitySignal(null, now)).toBeNull();
    expect(activitySignal('bozuk', now)).toBeNull();
  });
});
