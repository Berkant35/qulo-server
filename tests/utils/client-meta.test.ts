import { describe, it, expect } from 'vitest';
import { clientMetaFromHeaders, isClientAtLeast, MEDIA_QUESTIONS_MIN_CLIENT } from '../../src/utils/client-meta.js';

/**
 * Rıza kaydına (KVKK denetim izi) giden istemci başlıkları.
 *
 * `user_consents.platform` DB'de CHECK kısıtlı (ios/android/web). Doğrulanmamış
 * bir değer upsert'i patlatır ve kayıt fire-and-forget olduğu için o kullanıcının
 * rızası SESSİZCE kaybolur. Bu yüzden tanınmayan değer → alan hiç yazılmaz.
 */
describe('clientMetaFromHeaders', () => {
  it('mobilin gönderdiği platform ve sürümü okur', () => {
    expect(clientMetaFromHeaders({ 'x-app-platform': 'ios', 'x-app-version': '2.0.10+73' }))
      .toEqual({ platform: 'ios', appVersion: '2.0.10+73' });
  });

  it('build numarası olmayan sürüm de geçerli', () => {
    expect(clientMetaFromHeaders({ 'x-app-version': '2.0.10' }).appVersion).toBe('2.0.10');
  });

  it('platformda büyük/küçük harf ve boşluk farkı tolere edilir', () => {
    expect(clientMetaFromHeaders({ 'x-app-platform': ' Android ' }).platform).toBe('android');
  });

  it('tanınmayan platform yazılmaz — CHECK kısıtını patlatmasın', () => {
    expect(clientMetaFromHeaders({ 'x-app-platform': 'windows' }).platform).toBeUndefined();
  });

  it('başlık yoksa (eski istemci) iki alan da boş', () => {
    expect(clientMetaFromHeaders({})).toEqual({});
  });

  it('sürüm biçiminde olmayan serbest metin yazılmaz', () => {
    // Hem baştaki hem sondaki çöp reddedilmeli: 'v2.0.10' regex'in ^ çapasını,
    // '2.0.10; DROP' $ çapasını korur (mutasyonla doğrulandı).
    for (const value of ['<script>', 'v2.0.10', '2.0.10; DROP', 'latest', '', '1'.repeat(21)]) {
      expect(clientMetaFromHeaders({ 'x-app-version': value }).appVersion, value).toBeUndefined();
    }
  });
});

describe('isClientAtLeast', () => {
  it('build numarasi yok sayilir: 2.0.19+101 >= 2.0.19', () => {
    expect(isClientAtLeast({ appVersion: '2.0.19+101' }, '2.0.19')).toBe(true);
    expect(isClientAtLeast({ appVersion: '2.0.19' }, '2.0.19')).toBe(true);
  });
  it('eski surum reddedilir', () => {
    expect(isClientAtLeast({ appVersion: '2.0.18+100' }, '2.0.19')).toBe(false);
  });
  it('sayisal karsilastirir (2.0.9 < 2.0.19, 2.1 > 2.0.19)', () => {
    expect(isClientAtLeast({ appVersion: '2.0.9' }, '2.0.19')).toBe(false);
    expect(isClientAtLeast({ appVersion: '2.1' }, '2.0.19')).toBe(true);
    expect(isClientAtLeast({ appVersion: '10.0.0' }, '2.0.19')).toBe(true);
  });
  it('surum yoksa ya da bozuksa false', () => {
    expect(isClientAtLeast({}, '2.0.19')).toBe(false);
    expect(isClientAtLeast({ appVersion: 'abc' }, '2.0.19')).toBe(false);
  });
  it('min build iceriyorsa build de karsilastirilir (2.0.18+101)', () => {
    const min = '2.0.18+101';
    expect(isClientAtLeast({ appVersion: '2.0.18+101' }, min)).toBe(true);
    expect(isClientAtLeast({ appVersion: '2.0.18+102' }, min)).toBe(true);
    expect(isClientAtLeast({ appVersion: '2.0.18+100' }, min)).toBe(false);
    expect(isClientAtLeast({ appVersion: '2.0.18' }, min)).toBe(false);
    expect(isClientAtLeast({ appVersion: '2.0.19+1' }, min)).toBe(true);
    expect(isClientAtLeast({ appVersion: '2.0.19' }, min)).toBe(true);
    expect(isClientAtLeast({ appVersion: '2.0.17+500' }, min)).toBe(false);
    expect(isClientAtLeast({}, min)).toBe(false);
    expect(isClientAtLeast({ appVersion: 'abc' }, min)).toBe(false);
  });
  it('medya soru esigi 2.0.18+101', () => {
    expect(MEDIA_QUESTIONS_MIN_CLIENT).toBe('2.0.18+101');
  });
});
