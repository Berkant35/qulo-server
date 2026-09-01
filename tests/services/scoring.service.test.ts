import { describe, it, expect, afterEach, vi } from 'vitest';
import { scoringService } from '../../src/services/scoring.service.js';

/**
 * Discover sıralamasını belirleyen saf fonksiyonlar — havuzun kime ne gösterdiğini
 * bunlar karar veriyor, yani cold-start ölçümleriyle doğrudan bağlılar.
 * Bağımlılık yok: sadece girdi/çıktı.
 */

const NOW = new Date('2026-09-01T12:00:00Z');
/** `saat` kadar önceye ait ISO zaman damgası. */
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe('desirabilityScore', () => {
  it('hiç gösterilmemiş kullanıcıya nötr 5 verir (sıfıra bölme yok)', () => {
    expect(scoringService.desirabilityScore(0, 0)).toBe(5);
    expect(Number.isFinite(scoringService.desirabilityScore(10, 0))).toBe(true);
  });

  it('beğeni oranı arttıkça skor artar', () => {
    const scores = [
      scoringService.desirabilityScore(0, 100),   // 0.0
      scoringService.desirabilityScore(15, 100),  // 0.15
      scoringService.desirabilityScore(30, 100),  // 0.30
      scoringService.desirabilityScore(50, 100),  // 0.50
      scoringService.desirabilityScore(70, 100),  // 0.70
    ];
    expect(scores).toEqual([1, 3, 5, 7, 10]);
  });

  it('eşik değerleri kapsayıcı değil — tam eşikte alt kademe', () => {
    expect(scoringService.desirabilityScore(60, 100)).toBe(7);  // 0.6, > değil
    expect(scoringService.desirabilityScore(61, 100)).toBe(10);
    expect(scoringService.desirabilityScore(10, 100)).toBe(1);  // 0.1, > değil
    expect(scoringService.desirabilityScore(11, 100)).toBe(3);
  });

  it('her zaman 1-10 aralığında', () => {
    for (const [like, shown] of [[0, 1], [1, 1], [100, 1], [0, 1000], [999, 1000]]) {
      const score = scoringService.desirabilityScore(like, shown);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(10);
    }
  });
});

describe('recencyScore', () => {
  it('kademeleri saat aralığına göre uygular', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(scoringService.recencyScore(hoursAgo(0.5))).toBe(10);
    expect(scoringService.recencyScore(hoursAgo(3))).toBe(8);
    expect(scoringService.recencyScore(hoursAgo(12))).toBe(6);
    expect(scoringService.recencyScore(hoursAgo(48))).toBe(3);
    expect(scoringService.recencyScore(hoursAgo(100))).toBe(1);
  });

  /**
   * Kritik: 7 günden eski kullanıcı 0 alır ama ELENMEZ — discover'da hard filtre yok,
   * sadece skoru düşer. Cold-start havuzu bu yüzden daralmıyor.
   */
  it('7 günden eskiye 0 verir ama negatife inmez', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(scoringService.recencyScore(hoursAgo(169))).toBe(0);
    expect(scoringService.recencyScore(hoursAgo(24 * 365))).toBe(0);
  });

  it('gelecek tarihli last_seen negatif skor üretmez', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    expect(scoringService.recencyScore(hoursAgo(-5))).toBe(10);
  });

  it('skor zamanla monoton azalır', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const series = [0.5, 3, 12, 48, 100, 200].map((h) => scoringService.recencyScore(hoursAgo(h)));
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
    }
  });
});

describe('distanceScore', () => {
  it('sıfır mesafe tam puan', () => {
    expect(scoringService.distanceScore(0, 50)).toBe(10);
  });

  it('radius sınırında sıfır', () => {
    expect(scoringService.distanceScore(50, 50)).toBe(0);
  });

  it('yarı mesafede yarı puan', () => {
    expect(scoringService.distanceScore(25, 50)).toBe(5);
  });

  it('radius dışında negatife inmez', () => {
    expect(scoringService.distanceScore(500, 50)).toBe(0);
    expect(scoringService.distanceScore(1e6, 50)).toBe(0);
  });

  it('mesafe arttıkça skor azalır', () => {
    const series = [0, 10, 20, 30, 40, 50].map((d) => scoringService.distanceScore(d, 50));
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThan(series[i - 1]);
    }
  });
});

describe('profileScore', () => {
  it('tamamlanma yüzdesini 10 puana ölçekler', () => {
    expect(scoringService.profileScore(0, 0, false)).toBe(0);
    expect(scoringService.profileScore(50, 0, false)).toBe(5);
    expect(scoringService.profileScore(100, 0, false)).toBe(10);
  });

  it('3+ foto 2 puan bonus verir, 2 foto vermez', () => {
    expect(scoringService.profileScore(0, 2, false)).toBe(0);
    expect(scoringService.profileScore(0, 3, false)).toBe(2);
    expect(scoringService.profileScore(0, 10, false)).toBe(2);
  });

  it('bio 1 puan bonus verir', () => {
    expect(scoringService.profileScore(0, 0, true)).toBe(1);
  });

  /**
   * Diğer skorlar 0-10 iken bu 13'e çıkabiliyor. totalScore ağırlığı %10 olduğu için
   * etkisi sınırlı ama bilinçli bir asimetri — davranış değişirse test kırılsın.
   */
  it('üst sınırı 13 (diğer skorlardan farklı olarak 10 değil)', () => {
    expect(scoringService.profileScore(100, 5, true)).toBe(13);
    expect(scoringService.profileScore(999, 99, true)).toBe(13);
  });
});

describe('engagementScore', () => {
  it('yeşil elmas katkısı 5 puanda doyar', () => {
    expect(scoringService.engagementScore(0, 0)).toBe(0);
    expect(scoringService.engagementScore(125, 0)).toBe(2.5);
    expect(scoringService.engagementScore(250, 0)).toBe(5);
    expect(scoringService.engagementScore(100_000, 0)).toBe(5);
  });

  it('quiz tamamlama oranı 5 puana ölçeklenir', () => {
    expect(scoringService.engagementScore(0, 1)).toBe(5);
    expect(scoringService.engagementScore(0, 0.5)).toBe(2.5);
  });

  it('iki bileşen toplanır, üst sınır 10', () => {
    expect(scoringService.engagementScore(250, 1)).toBe(10);
  });
});

describe('totalScore', () => {
  const base = {
    desirability: 10, engagement: 10, recency: 10,
    distance: 10, profile: 10, boostActive: false,
  };

  /**
   * Ağırlıklar toplamı 0.95 — 1.0 değil. Yani "her şeyi mükemmel" bir profil 10 değil
   * 9.5 alıyor. Sıralama göreli olduğu için sonucu değiştirmiyor, ama bilinçsiz bir
   * değişiklik olmadığından emin olmak için sabitliyoruz.
   */
  it('tüm bileşenler 10 iken 9.5 verir (ağırlıklar toplamı 0.95)', () => {
    expect(scoringService.totalScore(base)).toBeCloseTo(9.5, 5);
  });

  it('boost sabit 50 puan ekler — diğer her şeyi ezer', () => {
    const withBoost = scoringService.totalScore({ ...base, boostActive: true });
    expect(withBoost).toBeCloseTo(59.5, 5);

    const perfectNoBoost = scoringService.totalScore(base);
    const worstWithBoost = scoringService.totalScore({
      desirability: 0, engagement: 0, recency: 0, distance: 0, profile: 0, boostActive: true,
    });
    expect(worstWithBoost).toBeGreaterThan(perfectNoBoost);
  });

  it('desirability ve engagement en ağır bileşenler (%25)', () => {
    const zero = { desirability: 0, engagement: 0, recency: 0, distance: 0, profile: 0, boostActive: false };
    const bump = (key: keyof typeof zero) => scoringService.totalScore({ ...zero, [key]: 10 });

    expect(bump('desirability')).toBeCloseTo(2.5, 5);
    expect(bump('engagement')).toBeCloseTo(2.5, 5);
    expect(bump('recency')).toBeCloseTo(2.0, 5);
    expect(bump('distance')).toBeCloseTo(1.5, 5);
    expect(bump('profile')).toBeCloseTo(1.0, 5);
  });

  it('hepsi sıfırken sıfır', () => {
    expect(scoringService.totalScore({
      desirability: 0, engagement: 0, recency: 0, distance: 0, profile: 0, boostActive: false,
    })).toBe(0);
  });
});
