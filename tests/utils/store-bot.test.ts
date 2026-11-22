import { describe, it, expect } from 'vitest';
import { isStoreBot } from '../../src/utils/store-bot.js';

/**
 * Play on-lansman (Firebase Test Lab) botları — `users.is_store_bot`.
 * İmzalar 2026-11-17 canlı veriyle doğrulandı; yalnız metrik ayıklaması, davranış değişmez.
 */
describe('isStoreBot', () => {
  it('x-test-lab başlığı her e-postada ve platformda kesin sinyal', () => {
    expect(isStoreBot('ayse@gmail.com', { testLab: true })).toBe(true);
    expect(isStoreBot('testuser777@example.com', { platform: 'ios', testLab: true })).toBe(true);
  });

  it('Test Lab Google hesabı (@cloudtestlabaccounts.com) platformdan bağımsız bot', () => {
    expect(isStoreBot('xourglknlkbos7fv7vuvulifem-02@cloudtestlabaccounts.com')).toBe(true);
    expect(isStoreBot('  ABC-01@CloudTestLabAccounts.com ')).toBe(true);
  });

  it('Android + adsoyad.12345@gmail.com kalıbı bot', () => {
    expect(isStoreBot('betsyhicks.16617@gmail.com', { platform: 'android' })).toBe(true);
    expect(isStoreBot('ShainaThames.90503@Gmail.com', { platform: 'android' })).toBe(true);
  });

  it('aynı kalıp iOS/web/bilinmeyen platformda gerçek kullanıcı sayılır', () => {
    expect(isStoreBot('betsyhicks.16617@gmail.com', { platform: 'ios' })).toBe(false);
    expect(isStoreBot('betsyhicks.16617@gmail.com', { platform: 'web' })).toBe(false);
    expect(isStoreBot('betsyhicks.16617@gmail.com')).toBe(false);
  });

  it('kalıba yakın ama farklı gerçek Android adresleri bot değil', () => {
    // Rakam sayısı, ayraç, alan adı ya da harf dışı karakter farkı → gerçek kullanıcı.
    for (const email of [
      'sahinyildiz.252123@gmail.com', // 6 hane (gerçek kullanıcı, 11-16)
      'yasinayd7549@gmail.com', // nokta yok
      'ali.1234@gmail.com', // 4 hane
      'john.12345@hotmail.com', // gmail değil
      'mehmet_k.12345@gmail.com', // alt çizgi
      'xbetsyhicks.16617@gmail.com.tr', // sonu sabitli
    ]) {
      expect(isStoreBot(email, { platform: 'android' }), email).toBe(false);
    }
  });

  it('boş/eksik e-posta (Apple gizli e-posta yedeği) bot sayılmaz', () => {
    expect(isStoreBot('', { platform: 'android' })).toBe(false);
    expect(isStoreBot(null, { platform: 'android' })).toBe(false);
    expect(isStoreBot(undefined)).toBe(false);
  });
});
