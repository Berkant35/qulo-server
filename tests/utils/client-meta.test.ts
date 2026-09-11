import { describe, it, expect } from 'vitest';
import { clientMetaFromHeaders } from '../../src/utils/client-meta.js';

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
